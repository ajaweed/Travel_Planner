// Tours & activities search + booking, shaped against the Viator Partner API
// (https://docs.viator.com/partner-api/).
//
// IMPORTANT — production readiness: Viator issues sandbox keys on signup,
// but production access requires approval as a registered affiliate/partner
// and passing their integration review. Keep VIATOR_ENV=sandbox until that's
// granted.

import type {
  BookingConfirmation,
  IdempotentRequest,
  ProviderMode,
  ProviderResult,
  TourOffer,
  TourSearchParams,
} from "./types";

function loadEnv(): ProviderMode {
  return (process.env.VIATOR_ENV as ProviderMode) ?? "sandbox";
}

function baseUrl(env: ProviderMode): string {
  return env === "production"
    ? "https://api.viator.com/partner"
    : "https://api.sandbox.viator.com/partner";
}

function apiKey(): string | undefined {
  return process.env.VIATOR_API_KEY;
}

export async function searchTours(
  params: TourSearchParams,
): Promise<ProviderResult<TourOffer[]>> {
  const key = apiKey();
  if (!key) {
    return {
      ok: false,
      reason: "NOT_CONFIGURED",
      message: "VIATOR_API_KEY is not set. Register at https://partnerresources.viator.com.",
    };
  }
  const env = loadEnv();
  try {
    const res = await fetch(`${baseUrl(env)}/products/search`, {
      method: "POST",
      headers: {
        "exp-api-key": key,
        "Content-Type": "application/json",
        Accept: "application/json;version=2.0",
      },
      body: JSON.stringify({
        filtering: {
          destination: params.destination,
          startDate: params.date,
          tags: params.interests,
        },
        pagination: { start: 1, count: 10 },
      }),
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("Retry-After") ?? "1") * 1000;
      return { ok: false, reason: "RATE_LIMITED", retryAfterMs: retryAfter };
    }
    if (!res.ok) {
      return {
        ok: false,
        reason: "PROVIDER_ERROR",
        message: `Viator search failed: ${res.status}`,
        retryable: res.status >= 500,
      };
    }
    const json = (await res.json()) as { products?: ViatorProductDto[] };
    const products = json.products ?? [];
    if (products.length === 0) {
      return { ok: false, reason: "NO_AVAILABILITY" };
    }
    return {
      ok: true,
      data: products.map((p) => mapTourOffer(p, params)),
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

export async function bookTour(
  req: IdempotentRequest<{ offerId: string; offerRaw: unknown; participantInfo: unknown }>,
): Promise<ProviderResult<BookingConfirmation>> {
  const key = apiKey();
  if (!key) {
    return { ok: false, reason: "NOT_CONFIGURED", message: "VIATOR_API_KEY is not set." };
  }
  const env = loadEnv();
  if (env === "production") {
    return {
      ok: false,
      reason: "PROVIDER_ERROR",
      message:
        "VIATOR_ENV is 'production' but partner approval for live bookings has not " +
        "been confirmed. Keep this in sandbox until Viator approves the account for " +
        "production bookings.",
      retryable: false,
    };
  }
  try {
    const res = await fetch(`${baseUrl(env)}/bookings/book`, {
      method: "POST",
      headers: {
        "exp-api-key": key,
        "Content-Type": "application/json",
        Accept: "application/json;version=2.0",
        "Idempotency-Key": req.idempotencyKey, // Viator supports this natively
      },
      body: JSON.stringify({
        productCode: req.offerId,
        travelers: req.participantInfo,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      if (text.includes("SOLD_OUT")) return { ok: false, reason: "NO_AVAILABILITY" };
      return {
        ok: false,
        reason: "PROVIDER_ERROR",
        message: `Viator booking failed: ${res.status} ${text}`,
        retryable: res.status >= 500,
      };
    }
    const json = (await res.json()) as {
      bookingReference: string;
      totalPrice: { amount: number; currency: string };
    };
    return {
      ok: true,
      data: {
        providerRef: json.bookingReference,
        price: {
          amountCents: Math.round(json.totalPrice.amount * 100),
          currency: json.totalPrice.currency,
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

type ViatorProductDto = {
  productCode: string;
  title: string;
  duration?: { fixedDurationInMinutes?: number };
  pricing?: { summary?: { fromPrice?: number }; currency?: string };
};

function mapTourOffer(dto: ViatorProductDto, params: TourSearchParams): TourOffer {
  return {
    offerId: dto.productCode,
    title: dto.title,
    date: params.date,
    durationMinutes: dto.duration?.fixedDurationInMinutes ?? 0,
    price: {
      amountCents: Math.round((dto.pricing?.summary?.fromPrice ?? 0) * 100),
      currency: dto.pricing?.currency ?? "USD",
    },
  };
}
