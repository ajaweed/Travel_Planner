// Shared vocabulary every provider adapter speaks, so packages/core never
// has to know which real-world API a given booking went through.

export type Money = {
  amountCents: number;
  currency: string; // ISO 4217, e.g. "USD"
};

export type ProviderMode = "sandbox" | "production";

/**
 * Outcomes a search/booking call can produce. Modeled as a discriminated
 * union (not thrown Errors) because the caller (BookingAgent) has to branch
 * on these as real, expected business outcomes — not failures of the code.
 */
export type ProviderResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "NO_AVAILABILITY" }
  | { ok: false; reason: "PRICE_CHANGED"; newPrice: Money }
  | { ok: false; reason: "RATE_LIMITED"; retryAfterMs: number }
  | { ok: false; reason: "PROVIDER_ERROR"; message: string; retryable: boolean }
  | { ok: false; reason: "NOT_CONFIGURED"; message: string };

export type FlightOffer = {
  offerId: string;
  origin: string; // IATA
  destination: string; // IATA
  departAt: string; // ISO 8601
  arriveAt: string; // ISO 8601
  carrier: string;
  stops: number;
  price: Money;
};

export type FlightSearchParams = {
  origin: string;
  destination: string;
  departDate: string; // YYYY-MM-DD
  returnDate?: string;
  adults: number;
};

export type HotelOffer = {
  offerId: string;
  propertyName: string;
  address: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string;
  roomDescription: string;
  price: Money; // total for the stay
};

export type HotelSearchParams = {
  cityCode: string; // IATA city code or provider-specific locality id
  checkIn: string;
  checkOut: string;
  adults: number;
};

export type TourOffer = {
  offerId: string;
  title: string;
  date: string; // YYYY-MM-DD
  durationMinutes: number;
  price: Money;
};

export type TourSearchParams = {
  destination: string;
  date: string;
  participants: number;
  interests?: string[];
};

// --- Reviews (read-only comparison data; see reviews.ts) ---

export type PlaceReviewExcerpt = {
  text: string; // verbatim from the provider -- never summarized or invented
  rating?: number;
  authorName?: string;
  relativeTime?: string; // e.g. "2 months ago", as the provider phrases it
};

/**
 * A real, resolved place with its real rating. Every rating field is optional
 * on purpose: a place that exists but has no ratings yet must come back with
 * them absent rather than zeroed, so the UI can say "no rating available"
 * instead of showing a 0.0 nobody earned.
 */
export type PlaceReviewSummary = {
  placeId: string;
  name: string; // the provider's name for the place, not the queried string
  formattedAddress?: string;
  rating?: number; // 1.0 - 5.0
  userRatingsTotal?: number;
  excerpts: PlaceReviewExcerpt[];
  googleMapsUri?: string;
  source: "google_places";
};

export type PlaceReviewLookupParams = {
  placeName: string; // a specific candidate name, e.g. "Memmo Alfama Hotel"
  locationHint?: string; // city/destination, to disambiguate chains
};

export type BookingConfirmation = {
  providerRef: string;
  price: Money;
  raw?: unknown; // provider's raw confirmation payload, for audit/support
};

/** Every booking mutation must carry one of these so retries can't double-book. */
export type IdempotentRequest<T> = T & { idempotencyKey: string };
