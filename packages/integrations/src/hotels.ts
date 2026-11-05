// Hotel search + booking. Provider-agnostic at the call site
// (packages/core only calls searchHotels/bookHotel) — HOTEL_PROVIDER picks
// which concrete adapter runs underneath.
//
// Shipped implementation: Amadeus Hotel Search + Hotel Booking APIs (reuses
// the same OAuth2 client-credentials flow as flights.ts). Swapping to
// Expedia Rapid API or Booking.com's Demand API means implementing the same
// HotelProviderAdapter interface below and switching HOTEL_PROVIDER.
//
// IMPORTANT — production readiness: all three candidate providers require a
// signed partner/affiliate agreement before they issue production
// credentials. Sandbox/test credentials are available without that, which
// is what this adapter assumes until HOTEL_PROVIDER_ENV=production.

import type {
  BookingConfirmation,
  HotelOffer,
  HotelSearchParams,
  IdempotentRequest,
  ProviderMode,
  ProviderResult,
} from "./types";

interface HotelProviderAdapter {
  search(params: HotelSearchParams): Promise<ProviderResult<HotelOffer[]>>;
  book(
    req: IdempotentRequest<{ offerId: string; offerRaw: unknown; guestInfo: unknown }>,
  ): Promise<ProviderResult<BookingConfirmation>>;
}

function loadMode(): ProviderMode {
  return (process.env.HOTEL_PROVIDER_ENV as ProviderMode) ?? "sandbox";
}

function baseUrl(env: ProviderMode): string {
  return env === "production"
    ? "https://api.amadeus.com"
    : "https://test.api.amadeus.com";
}

async function getAccessToken(env: ProviderMode): Promise<string> {
  const clientId = process.env.HOTEL_PROVIDER_CLIENT_ID;
  const clientSecret = process.env.HOTEL_PROVIDER_CLIENT_SECRET;
  const res = await fetch(`${baseUrl(env)}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId ?? "",
      client_secret: clientSecret ?? "",
    }),
  });
  if (!res.ok) throw new Error(`Hotel provider auth failed: ${res.status}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

const amadeusHotelAdapter: HotelProviderAdapter = {
  async search(params) {
    const clientId = process.env.HOTEL_PROVIDER_CLIENT_ID;
    const clientSecret = process.env.HOTEL_PROVIDER_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return {
        ok: false,
        reason: "NOT_CONFIGURED",
        message: "HOTEL_PROVIDER_CLIENT_ID / _SECRET are not set.",
      };
    }
    const env = loadMode();
    try {
      const token = await getAccessToken(env);
      const qs = new URLSearchParams({
        cityCode: params.cityCode,
        checkInDate: params.checkIn,
        checkOutDate: params.checkOut,
        adults: String(params.adults),
      });
      const res = await fetch(
        `${baseUrl(env)}/v3/shopping/hotel-offers?${qs.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After") ?? "1") * 1000;
        return { ok: false, reason: "RATE_LIMITED", retryAfterMs: retryAfter };
      }
      if (!res.ok) {
        return {
          ok: false,
          reason: "PROVIDER_ERROR",
          message: `Hotel search failed: ${res.status}`,
          retryable: res.status >= 500,
        };
      }
      const json = (await res.json()) as { data: AmadeusHotelOfferDto[] };
      if (!json.data || json.data.length === 0) {
        return { ok: false, reason: "NO_AVAILABILITY" };
      }
      return { ok: true, data: json.data.map(mapHotelOffer) };
    } catch (err) {
      return {
        ok: false,
        reason: "PROVIDER_ERROR",
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
      };
    }
  },

  async book(req) {
    const env = loadMode();
    if (env === "production") {
      return {
        ok: false,
        reason: "PROVIDER_ERROR",
        message:
          "HOTEL_PROVIDER_ENV is 'production' but no hotel partner agreement " +
          "has been confirmed. Keep this in sandbox until that's signed.",
        retryable: false,
      };
    }
    try {
      const token = await getAccessToken(env);
      const res = await fetch(`${baseUrl(env)}/v1/booking/hotel-bookings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          data: [{ offerId: req.offerId, guests: [req.guestInfo] }],
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        if (text.includes("NO_ROOMS_AVAILABLE")) {
          return { ok: false, reason: "NO_AVAILABILITY" };
        }
        return {
          ok: false,
          reason: "PROVIDER_ERROR",
          message: `Hotel booking failed: ${res.status} ${text}`,
          retryable: res.status >= 500,
        };
      }
      const json = (await res.json()) as {
        data: Array<{ id: string; providerConfirmationId: string; associatedRecords?: unknown }>;
      };
      const booking = json.data[0];
      return {
        ok: true,
        data: {
          providerRef: booking?.providerConfirmationId ?? booking?.id ?? "",
          price: { amountCents: 0, currency: "USD" }, // Amadeus returns price in the original offer, not the booking confirm; recompute from stored offer snapshot upstream.
          raw: json,
        },
      };
    } catch (err) {
      return {
        ok: false,
        reason: "PROVIDER_ERROR",
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
      };
    }
  },
};

const adapters: Record<string, HotelProviderAdapter> = {
  amadeus: amadeusHotelAdapter,
  // expedia_rapid: expediaRapidAdapter,      // implement when that agreement is signed
  // booking_demand: bookingDemandAdapter,    // implement when that agreement is signed
};

function currentAdapter(): HotelProviderAdapter {
  const key = process.env.HOTEL_PROVIDER ?? "amadeus";
  const adapter = adapters[key];
  if (!adapter) {
    throw new Error(
      `Unknown HOTEL_PROVIDER "${key}". Known adapters: ${Object.keys(adapters).join(", ")}`,
    );
  }
  return adapter;
}

export async function searchHotels(
  params: HotelSearchParams,
): Promise<ProviderResult<HotelOffer[]>> {
  return currentAdapter().search(params);
}

export async function bookHotel(
  req: IdempotentRequest<{ offerId: string; offerRaw: unknown; guestInfo: unknown }>,
): Promise<ProviderResult<BookingConfirmation>> {
  return currentAdapter().book(req);
}

type AmadeusHotelOfferDto = {
  hotel: { name: string; address?: { lines?: string[] } };
  offers: Array<{
    id: string;
    checkInDate: string;
    checkOutDate: string;
    room?: { description?: { text?: string } };
    price: { total: string; currency: string };
  }>;
};

function mapHotelOffer(dto: AmadeusHotelOfferDto): HotelOffer {
  const offer = dto.offers[0];
  return {
    offerId: offer?.id ?? "",
    propertyName: dto.hotel.name,
    address: dto.hotel.address?.lines?.join(", ") ?? "",
    checkIn: offer?.checkInDate ?? "",
    checkOut: offer?.checkOutDate ?? "",
    roomDescription: offer?.room?.description?.text ?? "",
    price: {
      amountCents: Math.round(parseFloat(offer?.price.total ?? "0") * 100),
      currency: offer?.price.currency ?? "USD",
    },
  };
}
