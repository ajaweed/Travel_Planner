// Tests the wiring between option generation and the reviews adapter. The
// adapter's own HTTP behaviour is covered in packages/integrations; what
// matters here is that a rating only ever reaches stored option JSON when the
// provider actually returned one, and that we don't pay for the same lookup
// twice.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaceReviewSummary, ProviderResult } from "@trip-planner/integrations";

const lookupPlaceReviews = vi.fn<
  (params: { placeName: string; locationHint?: string }) => Promise<
    ProviderResult<PlaceReviewSummary>
  >
>();

vi.mock("@trip-planner/integrations", () => ({
  reviews: {
    lookupPlaceReviews: (params: { placeName: string; locationHint?: string }) =>
      lookupPlaceReviews(params),
  },
}));

const { attachRealReviews } = await import("./reviewLookup");
type Draft = Parameters<typeof attachRealReviews>[0][number];

function summary(name: string, rating?: number): PlaceReviewSummary {
  return {
    placeId: `place_${name}`,
    name,
    rating,
    userRatingsTotal: rating === undefined ? undefined : 100,
    excerpts: [{ text: "Real review text." }],
    source: "google_places",
  };
}

function draftWith(
  bookables: Array<{ kind: "FLIGHT" | "HOTEL" | "TOUR"; candidateName?: string }>,
  label = "An option",
): Draft {
  return {
    label,
    summary: "A summary.",
    pace: "balanced",
    estimatedTotalCents: 150000,
    days: [
      {
        dayIndex: 0,
        activities: bookables.map((b, i) => ({
          title: `Activity ${i}`,
          bookable: { kind: b.kind, searchHint: `hint ${i}`, candidateName: b.candidateName },
        })),
      },
    ],
  };
}

/** The bookable items of the first day of an enriched option. */
function bookables(option: Awaited<ReturnType<typeof attachRealReviews>>[number]) {
  return option.days[0]!.activities.map((a) => a.bookable!);
}

beforeEach(() => {
  lookupPlaceReviews.mockReset();
});

describe("attachRealReviews", () => {
  it("attaches a real rating to the matching candidate", async () => {
    lookupPlaceReviews.mockResolvedValue({ ok: true, data: summary("Memmo Alfama Hotel", 4.6) });

    const [option] = await attachRealReviews(
      [draftWith([{ kind: "HOTEL", candidateName: "Memmo Alfama Hotel" }])],
      "Lisbon",
    );

    expect(option!.reviewLookup).toEqual({ status: "OK", lookedUp: 1, matched: 1 });
    expect(bookables(option!)[0]!.review?.rating).toBe(4.6);
    expect(lookupPlaceReviews).toHaveBeenCalledWith({
      placeName: "Memmo Alfama Hotel",
      locationHint: "Lisbon",
    });
  });

  it("attaches nothing and reports NOT_CONFIGURED without the provider key", async () => {
    lookupPlaceReviews.mockResolvedValue({
      ok: false,
      reason: "NOT_CONFIGURED",
      message: "GOOGLE_PLACES_API_KEY is not set.",
    });

    const options = await attachRealReviews(
      [
        draftWith([{ kind: "HOTEL", candidateName: "Hotel One" }], "A"),
        draftWith([{ kind: "HOTEL", candidateName: "Hotel Two" }], "B"),
      ],
      "Lisbon",
    );

    for (const option of options) {
      expect(option.reviewLookup.status).toBe("NOT_CONFIGURED");
      expect(bookables(option)[0]!.review).toBeUndefined();
    }
    // Short-circuited after the probe: the other name is never queried, since
    // a missing key fails identically every time.
    expect(lookupPlaceReviews).toHaveBeenCalledTimes(1);
  });

  it("attaches nothing when the name matches no real place", async () => {
    lookupPlaceReviews.mockResolvedValue({ ok: false, reason: "NO_AVAILABILITY" });

    const [option] = await attachRealReviews(
      [draftWith([{ kind: "HOTEL", candidateName: "Hotel Imaginary" }])],
      "Lisbon",
    );

    expect(option!.reviewLookup).toEqual({ status: "OK", lookedUp: 1, matched: 0 });
    expect(bookables(option!)[0]!.review).toBeUndefined();
  });

  it("attaches nothing for a real place that has no rating yet", async () => {
    lookupPlaceReviews.mockResolvedValue({ ok: true, data: summary("Brand New Guesthouse") });

    const [option] = await attachRealReviews(
      [draftWith([{ kind: "HOTEL", candidateName: "Brand New Guesthouse" }])],
      "Lisbon",
    );

    expect(option!.reviewLookup).toEqual({ status: "OK", lookedUp: 1, matched: 0 });
    expect(bookables(option!)[0]!.review).toBeUndefined();
  });

  it("looks a repeated candidate up once but attaches it to every option", async () => {
    lookupPlaceReviews.mockResolvedValue({ ok: true, data: summary("Shared Hotel", 4.2) });

    const options = await attachRealReviews(
      [
        draftWith([{ kind: "HOTEL", candidateName: "Shared Hotel" }], "A"),
        draftWith([{ kind: "HOTEL", candidateName: "shared hotel" }], "B"),
      ],
      "Lisbon",
    );

    expect(lookupPlaceReviews).toHaveBeenCalledTimes(1);
    expect(bookables(options[0]!)[0]!.review?.rating).toBe(4.2);
    expect(bookables(options[1]!)[0]!.review?.rating).toBe(4.2);
  });

  it("never queries a FLIGHT candidate name", async () => {
    const [option] = await attachRealReviews(
      [draftWith([{ kind: "FLIGHT", candidateName: "Some Airline" }])],
      "Lisbon",
    );

    expect(lookupPlaceReviews).not.toHaveBeenCalled();
    expect(option!.reviewLookup).toEqual({ status: "NO_CANDIDATES" });
  });

  it("reports NO_CANDIDATES when nothing was named, without calling the provider", async () => {
    const [option] = await attachRealReviews(
      [draftWith([{ kind: "HOTEL" }, { kind: "TOUR" }])],
      "Lisbon",
    );

    expect(lookupPlaceReviews).not.toHaveBeenCalled();
    expect(option!.reviewLookup).toEqual({ status: "NO_CANDIDATES" });
    expect(bookables(option!)[0]!.review).toBeUndefined();
  });

  it("keeps other candidates when one lookup errors", async () => {
    lookupPlaceReviews
      .mockResolvedValueOnce({ ok: true, data: summary("Good Hotel", 4.8) })
      .mockResolvedValueOnce({
        ok: false,
        reason: "PROVIDER_ERROR",
        message: "boom",
        retryable: true,
      });

    const [option] = await attachRealReviews(
      [
        draftWith([
          { kind: "HOTEL", candidateName: "Good Hotel" },
          { kind: "TOUR", candidateName: "Broken Tour" },
        ]),
      ],
      "Lisbon",
    );

    expect(option!.reviewLookup).toEqual({ status: "OK", lookedUp: 2, matched: 1 });
    const items = bookables(option!);
    expect(items[0]!.review?.rating).toBe(4.8);
    expect(items[1]!.review).toBeUndefined();
  });
});
