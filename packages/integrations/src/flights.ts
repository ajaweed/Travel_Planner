// Flight search + booking, shaped against the Amadeus for Developers APIs:
//   search:  GET  /v2/shopping/flight-offers
//   booking: POST /v1/booking/flight-orders
//
// IMPORTANT — production readiness:
// Amadeus Self-Service credentials (sandbox) are free to obtain and are
// enough for search. Actually CREATING flight orders in production requires
// Amadeus's Enterprise "Flight Create Orders" agreement — a business
// approval process, not just an API key. Until that's signed, AMADEUS_ENV
// must stay "sandbox" and bookFlight() will only ever hit Amadeus's test
// environment (which returns synthetic confirmations, not real tickets).

import type {
  BookingConfirmation,
  FlightOffer,
  FlightSearchParams,
  IdempotentRequest,
  ProviderMode,
  ProviderResult,
} from "./types";

type AmadeusConfig = {
  env: ProviderMode;
  clientId: string | undefined;
  clientSecret: string | undefined;
};

function loadConfig(): AmadeusConfig {
  return {
    env: (process.env.AMADEUS_ENV as ProviderMode) ?? "sandbox",
    clientId: process.env.AMADEUS_CLIENT_ID,
    clientSecret: process.env.AMADEUS_CLIENT_SECRET,
  };
}

function baseUrl(env: ProviderMode): string {
  return env === "production"
    ? "https://api.amadeus.com"
    : "https://test.api.amadeus.com";
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(config: AmadeusConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }
  const res = await fetch(`${baseUrl(config.env)}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId ?? "",
      client_secret: config.clientSecret ?? "",
    }),
  });
  if (!res.ok) {
    throw new Error(`Amadeus auth failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    // refresh a little early
    expiresAt: Date.now() + (json.expires_in - 30) * 1000,
  };
  return cachedToken.token;
}

export async function searchFlights(
  params: FlightSearchParams,
): Promise<ProviderResult<FlightOffer[]>> {
  const config = loadConfig();
  if (!config.clientId || !config.clientSecret) {
    return {
      ok: false,
      reason: "NOT_CONFIGURED",
      message:
        "AMADEUS_CLIENT_ID / AMADEUS_CLIENT_SECRET are not set. Register at " +
        "https://developers.amadeus.com to get sandbox credentials.",
    };
  }

  try {
    const token = await getAccessToken(config);
    const qs = new URLSearchParams({
      originLocationCode: params.origin,
      destinationLocationCode: params.destination,
      departureDate: params.departDate,
      adults: String(params.adults),
      currencyCode: "USD",
      max: "10",
    });
    if (params.returnDate) qs.set("returnDate", params.returnDate);

    const res = await fetch(
      `${baseUrl(config.env)}/v2/shopping/flight-offers?${qs.toString()}`,
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
        message: `Amadeus flight search failed: ${res.status}`,
        retryable: res.status >= 500,
      };
    }

    const json = (await res.json()) as { data: AmadeusFlightOfferDto[] };
    if (!json.data || json.data.length === 0) {
      return { ok: false, reason: "NO_AVAILABILITY" };
    }
    return { ok: true, data: json.data.map(mapOffer) };
  } catch (err) {
    return {
      ok: false,
      reason: "PROVIDER_ERROR",
      message: err instanceof Error ? err.message : String(err),
      retryable: true,
    };
  }
}

export async function bookFlight(
  req: IdempotentRequest<{ offerId: string; offerRaw: unknown; travelerInfo: unknown }>,
): Promise<ProviderResult<BookingConfirmation>> {
  const config = loadConfig();
  if (!config.clientId || !config.clientSecret) {
    return {
      ok: false,
      reason: "NOT_CONFIGURED",
      message: "Amadeus credentials are not set; cannot book.",
    };
  }
  if (config.env === "production") {
    return {
      ok: false,
      reason: "PROVIDER_ERROR",
      message:
        "AMADEUS_ENV is 'production' but this adapter has not been cleared for " +
        "live Flight Create Orders. Complete Amadeus's Enterprise agreement for " +
        "flight booking before flipping this to production.",
      retryable: false,
    };
  }

  try {
    const token = await getAccessToken(config);
    const res = await fetch(`${baseUrl(config.env)}/v1/booking/flight-orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/vnd.amadeus+json",
        // Amadeus doesn't have a native idempotency header for this endpoint;
        // dedupe at the orchestrator layer using req.idempotencyKey before
        // ever calling this function.
      },
      body: JSON.stringify({
        data: {
          type: "flight-order",
          flightOffers: [req.offerRaw],
          travelers: [req.travelerInfo],
        },
      }),
    });

    if (!res.ok) {
      const bodyText = await res.text();
      // Amadeus returns 400 with a specific error code when the priced offer
      // has expired/changed between search and booking.
      if (bodyText.includes("OFFER") && bodyText.includes("EXPIRED")) {
        return { ok: false, reason: "NO_AVAILABILITY" };
      }
      return {
        ok: false,
        reason: "PROVIDER_ERROR",
        message: `Amadeus booking failed: ${res.status} ${bodyText}`,
        retryable: res.status >= 500,
      };
    }

    const json = (await res.json()) as AmadeusOrderDto;
    return {
      ok: true,
      data: {
        providerRef: json.data.id,
        price: {
          amountCents: Math.round(
            parseFloat(json.data.flightOffers[0]?.price.grandTotal ?? "0") * 100,
          ),
          currency: json.data.flightOffers[0]?.price.currency ?? "USD",
        },
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
}

// --- Amadeus DTO shapes (trimmed to what we use) ---

type AmadeusFlightOfferDto = {
  id: string;
  itineraries: Array<{
    segments: Array<{
      departure: { iataCode: string; at: string };
      arrival: { iataCode: string; at: string };
      carrierCode: string;
    }>;
  }>;
  price: { grandTotal: string; currency: string };
};

type AmadeusOrderDto = {
  data: {
    id: string;
    flightOffers: Array<{ price: { grandTotal: string; currency: string } }>;
  };
};

function mapOffer(dto: AmadeusFlightOfferDto): FlightOffer {
  const firstItinerary = dto.itineraries[0];
  const segments = firstItinerary?.segments ?? [];
  const first = segments[0];
  const last = segments[segments.length - 1];
  return {
    offerId: dto.id,
    origin: first?.departure.iataCode ?? "",
    destination: last?.arrival.iataCode ?? "",
    departAt: first?.departure.at ?? "",
    arriveAt: last?.arrival.at ?? "",
    carrier: first?.carrierCode ?? "",
    stops: Math.max(segments.length - 1, 0),
    price: {
      amountCents: Math.round(parseFloat(dto.price.grandTotal) * 100),
      currency: dto.price.currency,
    },
  };
}
