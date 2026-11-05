// Read-only place reviews/ratings, backed by the Google Places API (New):
//   text search:   POST https://places.googleapis.com/v1/places:searchText
//   place details: GET  https://places.googleapis.com/v1/places/{placeId}
//
// WHY THIS EXISTS: the itinerary agent proposes a specific candidate hotel or
// tour by name. This adapter resolves that name to a real Google place and
// returns its real rating / review count / review excerpts, so a user
// comparing itinerary options sees actual signal instead of vibes. It is
// consumed by the itinerary-options flow in packages/core, NOT by
// BookingAgent -- nothing here books anything or spends money.
//
// NOT FABRICATED, EVER: if the key is missing, the name doesn't resolve, or
// Google errors, this returns a non-ok ProviderResult and the caller attaches
// no rating at all. There is deliberately no placeholder/default rating
// anywhere in this file.
//
// PRODUCTION READINESS -- unlike the booking providers, this one is
// self-serve: a standard Google Cloud API key with "Places API (New)" enabled
// is enough, with no partner/business agreement to negotiate. That is also why
// there is no sandbox/production mode switch here, unlike every other adapter
// in this directory: Google Places publishes no sandbox environment, there is
// exactly one live, billed endpoint. That's acceptable only because these are
// read-only lookups -- the moment anything here could commit money it would
// need the same sandbox gate the booking adapters have.
//
// COST: each lookupPlaceReviews() call is up to two billable Places requests
// (one Text Search, one Place Details). Callers should de-duplicate candidate
// names before calling -- packages/core's options flow does.

import type {
  PlaceReviewExcerpt,
  PlaceReviewLookupParams,
  PlaceReviewSummary,
  ProviderResult,
} from "./types";

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places";

// Google requires an explicit field mask -- there is no default, and an
// omitted mask is an error. Requesting only what we use also keeps the call in
// a cheaper SKU tier.
const SEARCH_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.rating",
  "places.userRatingCount",
].join(",");

const DETAILS_FIELD_MASK = ["id", "rating", "userRatingCount", "reviews", "googleMapsUri"].join(",");

const MAX_EXCERPTS = 2;

function apiKey(): string | undefined {
  return process.env.GOOGLE_PLACES_API_KEY;
}

function notConfigured(): ProviderResult<never> {
  return {
    ok: false,
    reason: "NOT_CONFIGURED",
    message:
      "GOOGLE_PLACES_API_KEY is not set, so no real ratings can be looked up. " +
      "Create a Google Cloud API key with the 'Places API (New)' enabled " +
      "(https://console.cloud.google.com/apis/credentials) and set it in .env.local.",
  };
}

/**
 * Resolve a specific place name to its real Google rating plus a couple of
 * real review excerpts. Returns NO_AVAILABILITY when the name doesn't match a
 * real place -- a normal outcome for a model-suggested candidate, not an
 * error, and one that must surface as "no rating available" rather than a
 * placeholder number.
 */
export async function lookupPlaceReviews(
  params: PlaceReviewLookupParams,
): Promise<ProviderResult<PlaceReviewSummary>> {
  const key = apiKey();
  if (!key) return notConfigured();

  const query = [params.placeName, params.locationHint].filter(Boolean).join(", ");
  if (!query.trim()) {
    return { ok: false, reason: "NO_AVAILABILITY" };
  }

  const found = await textSearch(query, key);
  if (!found.ok) return found;

  // Details is a best-effort enrichment for the review excerpts: the rating
  // and review count already came back from the search, so a details failure
  // degrades to "rating but no quotes" instead of losing the whole lookup.
  const details = await placeDetails(found.data.placeId, key);
  if (!details.ok) return found;

  return {
    ok: true,
    data: {
      ...found.data,
      excerpts: details.data.excerpts,
      googleMapsUri: details.data.googleMapsUri,
      // Same numbers as the search returned, but the details call is the
      // fresher read of the two; fall back to the search values if absent.
      rating: details.data.rating ?? found.data.rating,
      userRatingsTotal: details.data.userRatingsTotal ?? found.data.userRatingsTotal,
    },
  };
}

async function textSearch(query: string, key: string): Promise<ProviderResult<PlaceReviewSummary>> {
  try {
    const res = await fetch(TEXT_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": SEARCH_FIELD_MASK,
      },
      body: JSON.stringify({ textQuery: query, pageSize: 1, languageCode: "en" }),
    });

    if (!res.ok) {
      return mapHttpFailure(
        res.status,
        await safeText(res),
        "Places text search",
        res.headers.get("Retry-After"),
      );
    }

    const json = (await res.json()) as { places?: PlaceDto[] };
    const place = json.places?.[0];
    if (!place?.id) return { ok: false, reason: "NO_AVAILABILITY" };

    return {
      ok: true,
      data: {
        placeId: place.id,
        name: place.displayName?.text ?? query,
        formattedAddress: place.formattedAddress,
        rating: place.rating,
        userRatingsTotal: place.userRatingCount,
        excerpts: [],
        source: "google_places",
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

type PlaceDetailsResult = {
  rating?: number;
  userRatingsTotal?: number;
  excerpts: PlaceReviewExcerpt[];
  googleMapsUri?: string;
};

async function placeDetails(
  placeId: string,
  key: string,
): Promise<ProviderResult<PlaceDetailsResult>> {
  try {
    const res = await fetch(`${PLACE_DETAILS_URL}/${encodeURIComponent(placeId)}`, {
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": DETAILS_FIELD_MASK,
      },
    });

    if (!res.ok) {
      return mapHttpFailure(
        res.status,
        await safeText(res),
        "Places details",
        res.headers.get("Retry-After"),
      );
    }

    const json = (await res.json()) as PlaceDetailsDto;
    return {
      ok: true,
      data: {
        rating: json.rating,
        userRatingsTotal: json.userRatingCount,
        googleMapsUri: json.googleMapsUri,
        excerpts: (json.reviews ?? [])
          .map(mapExcerpt)
          .filter((e): e is PlaceReviewExcerpt => e !== null)
          .slice(0, MAX_EXCERPTS),
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

/**
 * Google Cloud APIs answer failures with { error: { code, status, message } }.
 * Quota exhaustion shows up as either a 429 or a 403 carrying
 * RESOURCE_EXHAUSTED, so both map to RATE_LIMITED; a plain 403 (key
 * restricted, or Places API not enabled on the project) is a real
 * configuration problem and must not be retried.
 */
function mapHttpFailure(
  status: number,
  body: string,
  label: string,
  retryAfterHeader?: string | null,
): ProviderResult<never> {
  if (status === 429 || (status === 403 && body.includes("RESOURCE_EXHAUSTED"))) {
    // Honour Retry-After when Google sends it, same as tours.ts; 1s otherwise.
    const seconds = Number(retryAfterHeader ?? "");
    return {
      ok: false,
      reason: "RATE_LIMITED",
      retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000,
    };
  }
  return {
    ok: false,
    reason: "PROVIDER_ERROR",
    message: `${label} failed: ${status} ${body}`.trim(),
    retryable: status >= 500,
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}

function mapExcerpt(dto: PlaceReviewDto): PlaceReviewExcerpt | null {
  const text = dto.text?.text?.trim();
  if (!text) return null;
  return {
    text,
    rating: dto.rating,
    authorName: dto.authorAttribution?.displayName,
    relativeTime: dto.relativePublishTimeDescription,
  };
}

// --- Google Places (New) wire shapes, narrowed to the fields we request ---

type PlaceDto = {
  id?: string;
  displayName?: { text?: string; languageCode?: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
};

type PlaceReviewDto = {
  text?: { text?: string; languageCode?: string };
  rating?: number;
  authorAttribution?: { displayName?: string };
  relativePublishTimeDescription?: string;
};

type PlaceDetailsDto = {
  id?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  reviews?: PlaceReviewDto[];
};
