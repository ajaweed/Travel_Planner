// Attaches REAL rating data to the candidate places named in itinerary
// options, by looking each name up through packages/integrations' reviews
// adapter (Google Places).
//
// Deliberately not an agent and deliberately not part of BookingAgent: this is
// read-only comparison data gathered once, while options are being generated,
// and it never touches a booking tool or spends money.
//
// Two invariants:
//  1. A `review` is attached only when a real place was matched AND it has a
//     real rating. Missing key, unmatched name, provider error, or a real place
//     with no ratings yet all end the same way -- no review attached, and the
//     UI says "no rating available". Nothing here ever synthesizes a number.
//  2. The reported status distinguishes *why* ratings are missing: we never
//     looked (NOT_CONFIGURED), we looked and the provider was broken
//     (UNAVAILABLE), we looked and found nothing (OK with matched: 0), or there
//     was nothing to look up (NO_CANDIDATES). Collapsing those would mislead
//     the user about whose gap it is.

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
 * the cap is here so a pathological itinerary can't run up a bill. Names past
 * the cap are reported as named-but-not-looked-up rather than silently lost.
 */
const MAX_LOOKUPS_PER_GENERATION = 15;

type Candidate = { name: string; key: string };

type LookupOutcome = {
  key: string;
  summary: PlaceReviewSummary | null;
  /** True only for provider-side failures -- NOT for "this name isn't a real place". */
  failed: boolean;
  message?: string;
  notConfigured?: boolean;
};

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

  // Probe with one lookup first: if the provider isn't configured (no key, or a
  // key the provider rejects outright), every other call would fail
  // identically, so there's no point paying for them -- and the UI needs to
  // distinguish "not configured" from "no match".
  const probeResult = await lookupOne(probe, locationHint);
  if (probeResult.notConfigured) {
    return drafts.map((d) =>
      withReviews(d, new Map(), {
        status: "NOT_CONFIGURED",
        message: probeResult.message ?? "The ratings provider is not configured.",
      }),
    );
  }

  const outcomes: LookupOutcome[] = [
    probeResult,
    ...(await Promise.all(rest.map((candidate) => lookupOne(candidate, locationHint)))),
  ];

  const found = new Map<string, AttachedReview>();
  for (const outcome of outcomes) {
    // A resolved place is only usable as a rating badge if it actually has a
    // rating. A brand-new hotel with zero reviews must read as "no rating
    // available", never as 0.0.
    if (outcome.summary && outcome.summary.rating !== undefined) {
      found.set(outcome.key, outcome.summary);
    }
  }

  const failures = outcomes.filter((o) => o.failed);

  // Configured but entirely broken (quota exhausted, outage) is NOT the same
  // as "none of these places exist", and must not be reported as 0 matches.
  const status: ReviewLookupStatus =
    failures.length === outcomes.length
      ? {
          status: "UNAVAILABLE",
          message: failures[0]?.message ?? "The ratings provider could not be reached.",
        }
      : {
          status: "OK",
          named: candidates.length,
          lookedUp: outcomes.length,
          matched: found.size,
          failed: failures.length,
        };

  return drafts.map((d) => withReviews(d, found, status));
}

async function lookupOne(candidate: Candidate, locationHint: string): Promise<LookupOutcome> {
  const result = await reviews.lookupPlaceReviews({
    placeName: candidate.name,
    locationHint,
  });

  if (result.ok) {
    return { key: candidate.key, summary: result.data, failed: false };
  }
  if (result.reason === "NOT_CONFIGURED") {
    return {
      key: candidate.key,
      summary: null,
      failed: true,
      message: result.message,
      notConfigured: true,
    };
  }
  // A name that doesn't resolve is an expected outcome of asking a model to
  // suggest a place -- the provider worked fine, the guess just wasn't real.
  if (result.reason === "NO_AVAILABILITY") {
    return { key: candidate.key, summary: null, failed: false };
  }
  return {
    key: candidate.key,
    summary: null,
    failed: true,
    message:
      result.reason === "RATE_LIMITED"
        ? "The ratings provider is rate-limiting requests right now."
        : result.reason === "PROVIDER_ERROR"
          ? result.message
          : "The ratings provider returned an unexpected result.",
  };
}

/** Distinct HOTEL/TOUR candidate names across every option, in stable order. */
function collectCandidates(drafts: ItineraryOptionDraft[]): Candidate[] {
  const seen = new Map<string, Candidate>();
  for (const draft of drafts) {
    for (const day of draft.days) {
      for (const activity of day.activities) {
        const name = ratableName(activity.bookable);
        if (!name) continue;
        const key = candidateKey(name);
        if (!seen.has(key)) seen.set(key, { name, key });
      }
    }
  }
  return [...seen.values()];
}

/**
 * The candidate name of a bookable that can legitimately carry a place rating,
 * or undefined. FLIGHT is excluded both when collecting AND when attaching:
 * matching on the name alone would let a flight whose candidateName collided
 * with a hotel's inherit that hotel's rating, which is exactly the kind of
 * wrong rating this module exists to prevent.
 */
function ratableName(bookable: { kind: string; candidateName?: string } | undefined) {
  if (bookable?.kind !== "HOTEL" && bookable?.kind !== "TOUR") return undefined;
  const name = bookable.candidateName?.trim();
  return name ? name : undefined;
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
      const name = ratableName(activity.bookable);
      if (!name || !activity.bookable) return activity;
      const review = found.get(candidateKey(name));
      if (!review) return activity;
      return { ...activity, bookable: { ...activity.bookable, review } };
    }),
  }));

  return { ...draft, days, reviewLookup };
}
