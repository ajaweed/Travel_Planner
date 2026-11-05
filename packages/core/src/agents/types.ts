import type { PlaceReviewSummary } from "@trip-planner/integrations";
import { z } from "zod";

// --- TripBrief: what the ConciergeAgent extracts from free text ---

export const TripBriefSchema = z.object({
  destinations: z.array(z.string()).min(1),
  originCity: z.string().optional(), // where they're flying from, if known
  startDate: z.string().optional(), // YYYY-MM-DD; optional if user said "sometime in March"
  endDate: z.string().optional(),
  flexibleDates: z.boolean().default(false),
  durationDays: z.number().int().positive().optional(),
  partySize: z.number().int().positive().default(1),
  travelingWith: z.string().optional(), // "partner", "two kids under 10", etc.
  budgetTotalCents: z.number().int().nonnegative(),
  currency: z.string().default("USD"),
  pace: z.enum(["relaxed", "balanced", "packed"]).default("balanced"),
  interests: z.array(z.string()).default([]), // "food", "hiking", "museums", ...
  mustInclude: z.array(z.string()).default([]),
  mustAvoid: z.array(z.string()).default([]),
  needsFlights: z.boolean().default(true),
  needsHotel: z.boolean().default(true),
  openToRecommendations: z
    .boolean()
    .default(true)
    .describe("true when the user said something like 'I don't know, surprise me'"),
});
export type TripBrief = z.infer<typeof TripBriefSchema>;

// A ConciergeAgent turn either has a complete brief, or needs one more
// answer from the user before it does. Never both.
export const ConciergeResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("complete"), brief: TripBriefSchema }),
  z.object({
    status: z.literal("needs_clarification"),
    question: z.string(),
    partialBrief: TripBriefSchema.partial(),
  }),
]);
export type ConciergeResult = z.infer<typeof ConciergeResultSchema>;

// --- Itinerary ---

export const BookableDraftSchema = z.object({
  // RESERVATION deliberately excluded: no reservation provider is wired up yet
  // (see architect.md's rule against orphaned tool-use capability claims).
  kind: z.enum(["FLIGHT", "HOTEL", "TOUR"]),
  searchHint: z.string(), // e.g. "flight LIS->OPO morning of day 3"
  /**
   * A specific real-world place the model is proposing for a HOTEL/TOUR, e.g.
   * "Memmo Alfama Hotel". Only set when the model can name a real one -- it's
   * used solely to look up that place's real rating for the options
   * comparison. The booking search still runs off searchHint, so this being
   * absent (or wrong) can never change what actually gets booked.
   */
  candidateName: z.string().optional(),
});
export type BookableDraft = z.infer<typeof BookableDraftSchema>;

export const ActivityDraftSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  bookable: BookableDraftSchema.optional(),
});
export type ActivityDraft = z.infer<typeof ActivityDraftSchema>;

export const ItineraryDayDraftSchema = z.object({
  dayIndex: z.number().int().nonnegative(),
  date: z.string().optional(),
  summary: z.string().optional(),
  activities: z.array(ActivityDraftSchema),
});
export type ItineraryDayDraft = z.infer<typeof ItineraryDayDraftSchema>;

export const ItineraryDraftSchema = z.object({
  days: z.array(ItineraryDayDraftSchema),
});
export type ItineraryDraft = z.infer<typeof ItineraryDraftSchema>;

// --- Itinerary options (what the user picks between, before any booking) ---

/**
 * One of several candidate itineraries, as returned by the ItineraryAgent.
 * The metadata fields exist so the comparison view can be read at a glance
 * without parsing every day.
 */
export const ItineraryOptionDraftSchema = ItineraryDraftSchema.extend({
  label: z.string(), // short, distinctive name for this option
  summary: z.string(), // one-paragraph pitch: what makes this one different
  /**
   * Display-only badge. Deliberately lenient: an unexpected value (the model
   * saying "moderate") must not throw away an otherwise-valid multi-day
   * itinerary, which strict parsing would -- the whole variant gets dropped.
   */
  pace: z.enum(["relaxed", "balanced", "packed"]).catch("balanced"),
  /**
   * The model's ESTIMATE of the whole-trip cost, integer minor units in the
   * brief's currency. A planning estimate for comparing options only -- real
   * prices come from provider searches at booking time, which is why the UI
   * labels it as an estimate and the DB column is named estimatedTotalCents.
   *
   * Coerced because models hand back "185000" as a string often enough that
   * failing the parse would cost a whole itinerary over a number we only ever
   * display. Still forced to an integer so money stays integer minor units.
   */
  estimatedTotalCents: z.coerce.number().int().nonnegative(),
});
export type ItineraryOptionDraft = z.infer<typeof ItineraryOptionDraftSchema>;

/**
 * Real rating data attached to a bookable item after generation, from
 * packages/integrations/src/reviews.ts. Reusing the adapter's own type rather
 * than re-declaring it: this is provider data we pass through, not something
 * we validate an LLM against. A `review` being present always means a real
 * rating was found -- there is no "empty" or placeholder rating object.
 */
export type AttachedReview = PlaceReviewSummary;

export type EnrichedBookableDraft = BookableDraft & { review?: AttachedReview };

export type EnrichedActivityDraft = Omit<ActivityDraft, "bookable"> & {
  bookable?: EnrichedBookableDraft;
};

export type EnrichedItineraryDayDraft = Omit<ItineraryDayDraft, "activities"> & {
  activities: EnrichedActivityDraft[];
};

/**
 * Why no rating data is shown, when none is. The UI has to tell the user the
 * difference between "we never looked" and "we looked and found nothing" --
 * see the honesty rule in ux-designer.md.
 */
export type ReviewLookupStatus =
  /** We looked. `named` can exceed `lookedUp` when the per-generation cap bit. */
  | { status: "OK"; named: number; lookedUp: number; matched: number; failed: number }
  /** No key, or a key the provider rejected -- we never actually looked. */
  | { status: "NOT_CONFIGURED"; message: string }
  /** Configured, but every lookup errored (quota, outage). Not "found nothing". */
  | { status: "UNAVAILABLE"; message: string }
  | { status: "NO_CANDIDATES" };

/** Exactly what gets serialized into ItineraryOption.draftJson. */
export type StoredItineraryOption = Omit<ItineraryOptionDraft, "days"> & {
  days: EnrichedItineraryDayDraft[];
  reviewLookup: ReviewLookupStatus;
};

// --- Budget ---

export const BudgetStatusSchema = z.object({
  budgetTotalCents: z.number().int(),
  committedCents: z.number().int(), // confirmed bookings
  pendingCents: z.number().int(), // awaiting-confirmation bookings
  remainingCents: z.number().int(),
  currency: z.string(),
  overBudget: z.boolean(),
});
export type BudgetStatus = z.infer<typeof BudgetStatusSchema>;

// --- Agent-to-agent event log (also what powers the notification feed) ---

export const AgentEventSchema = z.object({
  tripId: z.string(),
  kind: z.enum([
    "ITINERARY_READY",
    "BOOKING_CONFIRMED",
    "BOOKING_FAILED",
    "BUDGET_ALERT",
    "CLARIFICATION_NEEDED",
    "GENERAL",
  ]),
  message: z.string(),
});
export type AgentEvent = z.infer<typeof AgentEventSchema>;
