// Attaches REAL rating data to the candidate places named in itinerary
// options, by looking each name up through packages/integrations' reviews
// adapter (Google Places).
//
// Deliberately not an agent and deliberately not part of BookingAgent: this is
// read-only comparison data gathered once, while options are being generated,
// and it never touches a booking tool or spends money.
//
// The one invariant: a `review` is attached only when a real place was matched
// AND it has a real rating. Missing key, unmatched name, provider error, or a
// real place with no ratings yet all end the same way -- no review attached,
// and the UI says "no rating available". Nothing here ever synthesizes a
// number.

import { reviews, type PlaceReviewSummary } from "@trip-planner/integrations";
import type {
  AttachedReview,
  EnrichedItineraryDayDraft,
  ItineraryOptionDraft,
  ReviewLookupStatus,
  StoredItineraryOption,
} from "./agents/types";

/**
 * Caps the billable Places calls one generation can make (each lookup is up to
 * two requests). 3 options x 1 hotel + a few tours each sits well under this;
 * the cap is here so a pathological itinerary can't run up a bill.
 */
const MAX_LOOKUPS_PER_GENERATION = 15;

type Candidate = { name: string; key: string };

/**
 * Looks up every distinct candidate place across all options once, then
 * attaches the results to each option's bookable items.
 */
export async function attachRealReviews(
  drafts: ItineraryOptionDraft[],
  locationHint: string,
): Promise<StoredItineraryOption[]> {
  const candidates = collectCandidates(drafts);
  const [probe, ...rest] = candidates.slice(0, MAX_LOOKUPS_PER_GENERATION);

  // No option named a specific place, so there is nothing to look up. Not the
  // same thing as "looked and found nothing" -- the UI words them differently.
  if (!probe) {
    return drafts.map((d) => withReviews(d, new Map(), { status: "NO_CANDIDATES" }));
  }

  // Probe with one lookup first: if the provider isn't configured, every other
  // call would fail identically, so there's no point paying the latency for
  // them -- and the UI needs to distinguish "not configured" from "no match".
  const first = await reviews.lookupPlaceReviews({ placeName: probe.name, locationHint });
  if (!first.ok && first.reason === "NOT_CONFIGURED") {
    return drafts.map((d) =>
      withReviews(d, new Map(), { status: "NOT_CONFIGURED", message: first.message }),
    );
  }

  const found = new Map<string, AttachedReview>();
  recordIfUsable(found, probe.key, first.ok ? first.data : null);

  const restResults = await Promise.all(
    rest.map(async (candidate) => {
      const result = await reviews.lookupPlaceReviews({
        placeName: candidate.name,
        locationHint,
      });
      return { key: candidate.key, summary: result.ok ? result.data : null };
    }),
  );
  for (const { key, summary } of restResults) {
    recordIfUsable(found, key, summary);
  }

  const status: ReviewLookupStatus = {
    status: "OK",
    lookedUp: rest.length + 1,
    matched: found.size,
  };
  return drafts.map((d) => withReviews(d, found, status));
}

/**
 * A resolved place is only usable as a rating badge if it actually has a
 * rating. A brand-new hotel with zero reviews must read as "no rating
 * available", never as 0.0.
 */
function recordIfUsable(
  into: Map<string, AttachedReview>,
  key: string,
  summary: PlaceReviewSummary | null,
): void {
  if (summary && summary.rating !== undefined) {
    into.set(key, summary);
  }
}

/** Distinct HOTEL/TOUR candidate names across every option, in stable order. */
function collectCandidates(drafts: ItineraryOptionDraft[]): Candidate[] {
  const seen = new Map<string, Candidate>();
  for (const draft of drafts) {
    for (const day of draft.days) {
      for (const activity of day.activities) {
        const bookable = activity.bookable;
        if (!bookable?.candidateName) continue;
        // FLIGHT candidate names are meaningless to a places lookup (and the
        // prompt forbids them), so they're dropped rather than queried.
        if (bookable.kind !== "HOTEL" && bookable.kind !== "TOUR") continue;
        const name = bookable.candidateName.trim();
        if (!name) continue;
        const key = candidateKey(name);
        if (!seen.has(key)) seen.set(key, { name, key });
      }
    }
  }
  return [...seen.values()];
}

function candidateKey(name: string): string {
  return name.trim().toLowerCase();
}

function withReviews(
  draft: ItineraryOptionDraft,
  found: Map<string, AttachedReview>,
  reviewLookup: ReviewLookupStatus,
): StoredItineraryOption {
  const days: EnrichedItineraryDayDraft[] = draft.days.map((day) => ({
    ...day,
    activities: day.activities.map((activity) => {
      const bookable = activity.bookable;
      if (!bookable?.candidateName) return activity;
      const review = found.get(candidateKey(bookable.candidateName));
      if (!review) return activity;
      return { ...activity, bookable: { ...bookable, review } };
    }),
  }));

  return { ...draft, days, reviewLookup };
}
