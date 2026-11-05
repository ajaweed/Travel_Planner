// Contract tests for the Google Places reviews adapter, against recorded
// fixture shapes -- no live network, no real key (integrations-dev.md rule 5).
//
// The behaviour these lock down that actually matters: every non-ok path must
// stay non-ok, so a missing key or an unmatched name can never turn into a
// fabricated rating downstream.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookupPlaceReviews } from "./reviews";
import {
  apiDisabledBody,
  placeDetailsHit,
  quotaExceededBody,
  textSearchEmpty,
  textSearchHit,
  textSearchUnratedPlace,
} from "./__fixtures__/googlePlaces";

const KEY = "test-places-key";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: { "Content-Type": "application/json" } });
}

/** Routes by URL so each test states only the responses it cares about. */
function mockFetch(handlers: { search?: Response; details?: Response }) {
  const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes(":searchText")) {
      if (!handlers.search) throw new Error("unexpected search call");
      return handlers.search;
    }
    if (!handlers.details) throw new Error("unexpected details call");
    return handlers.details;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  process.env.GOOGLE_PLACES_API_KEY = KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_PLACES_API_KEY;
});

describe("lookupPlaceReviews", () => {
  it("returns NOT_CONFIGURED without an API key, and makes no network call", async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    const fetchMock = mockFetch({});

    const result = await lookupPlaceReviews({ placeName: "Memmo Alfama Hotel" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NOT_CONFIGURED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a real rating, review count, and at most two verbatim excerpts", async () => {
    mockFetch({
      search: jsonResponse(textSearchHit),
      details: jsonResponse(placeDetailsHit),
    });

    const result = await lookupPlaceReviews({
      placeName: "Memmo Alfama Hotel",
      locationHint: "Lisbon, Portugal",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.placeId).toBe("ChIJ_place_id_memmo_alfama");
    expect(result.data.name).toBe("Memmo Alfama Hotel");
    expect(result.data.rating).toBe(4.6);
    expect(result.data.userRatingsTotal).toBe(1843);
    expect(result.data.source).toBe("google_places");
    expect(result.data.excerpts).toHaveLength(2);
    expect(result.data.excerpts[0]).toMatchObject({
      text: "Rooftop pool over the rooftops of Alfama. Worth it.",
      rating: 5,
      authorName: "A. Traveller",
      relativeTime: "2 months ago",
    });
  });

  it("sends the API key and an explicit field mask (Places rejects a missing mask)", async () => {
    const fetchMock = mockFetch({
      search: jsonResponse(textSearchHit),
      details: jsonResponse(placeDetailsHit),
    });

    await lookupPlaceReviews({ placeName: "Memmo Alfama Hotel" });

    const searchInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = searchInit.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe(KEY);
    expect(headers["X-Goog-FieldMask"]).toContain("places.rating");
    expect(JSON.parse(String(searchInit.body))).toMatchObject({
      textQuery: "Memmo Alfama Hotel",
    });
  });

  it("returns NO_AVAILABILITY when the name matches no real place", async () => {
    mockFetch({ search: jsonResponse(textSearchEmpty) });

    const result = await lookupPlaceReviews({ placeName: "Hotel That Does Not Exist" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NO_AVAILABILITY");
  });

  it("leaves rating absent (not zero) for a real place with no ratings yet", async () => {
    mockFetch({
      search: jsonResponse(textSearchUnratedPlace),
      details: jsonResponse({ id: "ChIJ_place_id_brand_new" }),
    });

    const result = await lookupPlaceReviews({ placeName: "Brand New Guesthouse" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rating).toBeUndefined();
    expect(result.data.userRatingsTotal).toBeUndefined();
    expect(result.data.excerpts).toEqual([]);
  });

  it("keeps the search-derived rating when the details call fails", async () => {
    mockFetch({
      search: jsonResponse(textSearchHit),
      details: textResponse("{}", 500),
    });

    const result = await lookupPlaceReviews({ placeName: "Memmo Alfama Hotel" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rating).toBe(4.6);
    expect(result.data.excerpts).toEqual([]);
  });

  it("maps quota exhaustion (403 RESOURCE_EXHAUSTED) to RATE_LIMITED", async () => {
    mockFetch({ search: textResponse(quotaExceededBody, 403) });

    const result = await lookupPlaceReviews({ placeName: "Memmo Alfama Hotel" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("RATE_LIMITED");
  });

  it("maps a 429 to RATE_LIMITED", async () => {
    mockFetch({ search: textResponse("{}", 429) });

    const result = await lookupPlaceReviews({ placeName: "Memmo Alfama Hotel" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("RATE_LIMITED");
  });

  it("maps a disabled/restricted key to NOT_CONFIGURED, not a transient error", async () => {
    // It's a config problem, not an outage -- and reporting it as such lets
    // the caller stop after one probe instead of burning a billable request
    // per candidate on a key that will never work.
    mockFetch({ search: textResponse(apiDisabledBody, 403) });

    const result = await lookupPlaceReviews({ placeName: "Memmo Alfama Hotel" });

    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "NOT_CONFIGURED") {
      expect(result.message).toContain("403");
    } else {
      expect.unreachable("expected NOT_CONFIGURED");
    }
  });

  it("still classifies quota exhaustion when the error body is very long", async () => {
    // Classification must read the untruncated body: the status marker can sit
    // past any display truncation point.
    const padded = JSON.stringify({
      error: { code: 403, message: "x".repeat(900), status: "RESOURCE_EXHAUSTED" },
    });
    mockFetch({ search: textResponse(padded, 403) });

    const result = await lookupPlaceReviews({ placeName: "Memmo Alfama Hotel" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("RATE_LIMITED");
  });

  it("honours Retry-After on a 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", { status: 429, headers: { "Retry-After": "7" } }),
      ),
    );

    const result = await lookupPlaceReviews({ placeName: "Memmo Alfama Hotel" });

    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "RATE_LIMITED") {
      expect(result.retryAfterMs).toBe(7000);
    } else {
      expect.unreachable("expected RATE_LIMITED");
    }
  });

  it("maps a network throw to a retryable PROVIDER_ERROR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    );

    const result = await lookupPlaceReviews({ placeName: "Memmo Alfama Hotel" });

    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "PROVIDER_ERROR") {
      expect(result.retryable).toBe(true);
    } else {
      expect.unreachable("expected PROVIDER_ERROR");
    }
  });

  it("returns NO_AVAILABILITY for a blank candidate name without calling out", async () => {
    const fetchMock = mockFetch({});

    const result = await lookupPlaceReviews({ placeName: "   " });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NO_AVAILABILITY");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
