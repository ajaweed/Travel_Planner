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

export const ActivityDraftSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  bookable: z
    .object({
      kind: z.enum(["FLIGHT", "HOTEL", "TOUR", "RESERVATION"]),
      searchHint: z.string(), // e.g. "flight LIS->OPO morning of day 3"
    })
    .optional(),
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
