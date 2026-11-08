// ItineraryAgent: turns a confirmed TripBrief into ONE candidate day-by-day
// plan, framed by a variant (value / balanced / elevated). The orchestrator
// calls it once per variant to produce the 2-3 options the user picks between.
//
// It leaves bookable items (flights/hotels/tours) as *placeholders* with a
// searchHint for BookingAgent -- it never invents a confirmed booking itself.
// For HOTEL/TOUR items it may additionally name a specific real candidate
// place (candidateName), which is used only to look up that place's real
// rating for the comparison view; the booking search still runs off
// searchHint, unchanged.

import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { AGENT_MODEL, getClaudeClient } from "../claudeClient";
import { coerceStringifiedFields } from "./toolInputRepair";
import { todayISO } from "./tripDates";
import { ItineraryOptionDraftSchema, type ItineraryOptionDraft, type TripBrief } from "./types";

/**
 * How the options differ from each other. Separate calls (one per variant)
 * rather than one call returning three itineraries: the single-itinerary tool
 * shape is the one already proven against the real model, and asking for 3x
 * the output in one call triples the truncation surface at max_tokens while
 * losing per-variant retry. See docs/team-log.md.
 */
export type ItineraryVariant = {
  key: string;
  /** Appended to the user turn as the angle this particular option takes. */
  framing: string;
};

export const ITINERARY_VARIANTS: ItineraryVariant[] = [
  {
    key: "value",
    framing:
      "Make this the VALUE option: the cheapest version of this trip that is still genuinely " +
      "good. Aim to come in well under the stated budget (roughly 60-75% of it). Fewer paid " +
      "activities, more free/self-guided ones, simpler lodging in a well-located " +
      "neighbourhood. Slightly more relaxed pace than requested is fine here.",
  },
  {
    key: "balanced",
    framing:
      "Make this the BALANCED option: the trip exactly as the brief describes it, at the " +
      "requested pace, using most but not all of the budget (roughly 80-90%). This is the " +
      "straightforward reading of what the traveller asked for.",
  },
  {
    key: "elevated",
    framing:
      "Make this the ELEVATED option: spend close to the full budget (but never over it) on " +
      "fewer, better things -- a notably nicer hotel or a standout guided experience rather " +
      "than more items on the list. Fewer activities than the balanced option, each a bigger " +
      "deal.",
  },
];

const tools: Tool[] = [
  {
    name: "record_itinerary_option",
    description:
      "Record one complete candidate itinerary for the trip, including the metadata the user needs to compare it against the other options.",
    input_schema: {
      type: "object",
      properties: {
        label: {
          type: "string",
          description:
            "Short, distinctive name for this option as the traveller would see it on a card, e.g. 'Slow mornings in Alfama'. Not 'Option 1' and not the variant name.",
        },
        summary: {
          type: "string",
          description:
            "One short paragraph: what makes THIS option different from the others, and who it suits. This is the main thing the user reads when choosing.",
        },
        pace: { type: "string", enum: ["relaxed", "balanced", "packed"] },
        estimatedTotalCents: {
          type: "integer",
          minimum: 0,
          description:
            "Your best estimate of the whole-trip cost in INTEGER MINOR UNITS (cents) of the brief's currency, covering flights + lodging + paid activities. $1,850.00 is 185000, NOT 1850. An estimate for comparison only.",
        },
        days: {
          type: "array",
          items: {
            type: "object",
            properties: {
              dayIndex: { type: "integer", minimum: 0 },
              date: { type: "string" },
              summary: { type: "string" },
              activities: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                    startTime: { type: "string" },
                    endTime: { type: "string" },
                    bookable: {
                      type: "object",
                      description:
                        "Omit entirely for non-bookable narrative activities (meals, walking, free time) -- there is no reservation provider, so RESERVATION is not a valid kind here.",
                      properties: {
                        kind: { type: "string", enum: ["FLIGHT", "HOTEL", "TOUR"] },
                        searchHint: { type: "string" },
                        candidateName: {
                          type: "string",
                          description:
                            "For HOTEL and TOUR only: the name of a specific, real, currently-operating place or tour you are proposing (e.g. 'Memmo Alfama Hotel'), exactly as it would be searched for. Omit entirely if you are not reasonably confident a place by that name really exists -- a wrong name is worse than none. Never set this for FLIGHT.",
                        },
                      },
                      required: ["kind", "searchHint"],
                    },
                  },
                  required: ["title"],
                },
              },
            },
            required: ["dayIndex", "activities"],
          },
        },
      },
      required: ["label", "summary", "pace", "estimatedTotalCents", "days"],
    },
  },
];

const SYSTEM_PROMPT = `You are the itinerary planner for a trip-planning app. You receive a
structured TripBrief (destination(s), dates, budget, party, pace, interests) plus a framing
describing which ONE of several options you are producing right now, and you produce a
day-by-day itinerary for that option.

The traveller will see 2-3 options side by side and pick one, so yours must be a genuinely
distinct take on the brief -- different lodging tier, different number of paid activities,
different rhythm -- not a reworded version of the same trip.

Rules:
- Match the requested pace unless your framing says otherwise: "relaxed" means 2-3
  activities/day with real downtime, "packed" means a full day scheduled start to finish.
- There is exactly ONE bookable HOTEL activity for the whole stay, on day 0 ("Check in to
  <hotel>"), covering checkIn=day 0's date through checkOut=the final day's date. The final
  day's "check out" activity is plain narrative (no bookable field) -- it is NOT a second
  hotel booking.
- If needsFlights is true: a bookable FLIGHT activity on day 0 (arrival) and another on the
  final day (departure). Each flight's searchHint MUST include the actual origin and
  destination (use brief.originCity -- never "traveler's home city" or similar placeholder
  text) and the actual departure date in YYYY-MM-DD (computed from brief.startDate + the
  day's offset -- never a placeholder like "Day 1").
- Tours are bookable: { kind: "TOUR", searchHint }, with a concrete YYYY-MM-DD date in the
  hint (from brief.startDate + day offset) and enough detail for a search agent with no
  other context to find the right thing.
- For HOTEL and TOUR items, also set candidateName to a specific real place/tour you are
  proposing, when you can name one you are reasonably confident actually exists in that
  destination. We look that name up against a real reviews provider to show the traveller
  its real rating, so accuracy matters more than specificity: if you are not confident the
  name is real and currently operating, omit candidateName entirely and leave only the
  searchHint. Never guess a plausible-sounding name, never invent a rating yourself, and
  never set candidateName on a FLIGHT.
- searchHint keeps its existing job regardless of candidateName: it is the text the booking
  search actually runs on, so it must stand alone and describe the kind of thing wanted.
- Restaurant/dining reservations are NOT bookable -- there is no reservation provider wired
  up yet (see architect.md). Write them as plain narrative activities with no 'bookable'
  field at all; do not set kind: "RESERVATION".
- Every ItineraryDay's 'date' field must be a real YYYY-MM-DD computed from brief.startDate +
  dayIndex. If brief.startDate is missing/not a real date, leave 'date' unset entirely --
  never put a placeholder like "Day 1" in a date field.
- Respect mustInclude and mustAvoid literally. Respect budget directionally per your framing
  and never plan over the stated budget -- but exact pricing is BookingAgent's job, so
  estimatedTotalCents is a rough comparison figure, not a quote.
- Always call record_itinerary_option exactly once with the full plan.`;

export async function runItineraryAgent(
  brief: TripBrief,
  variant: ItineraryVariant,
): Promise<ItineraryOptionDraft> {
  const client = getClaudeClient();

  const res = await client.messages.create({
    model: AGENT_MODEL,
    // Generous on purpose: a full multi-day plan with per-item search hints
    // and candidate names is a lot of tool-call JSON, and hitting the cap
    // truncates it mid-structure (which is how the malformed-input path in
    // toolInputRepair.ts gets exercised for real).
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    tools,
    tool_choice: { type: "tool", name: "record_itinerary_option" },
    messages: [
      {
        role: "user",
        content: `TripBrief:\n${JSON.stringify(brief)}\n\nFraming for this option:\n${variant.framing}`,
      },
    ],
  });

  const toolUse = res.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(
      `ItineraryAgent did not produce a tool call for variant "${variant.key}" (stop_reason: ${res.stop_reason}).`,
    );
  }

  const rawInput = toolUse.input as Record<string, unknown>;
  let parsed = ItineraryOptionDraftSchema.safeParse(rawInput);
  if (!parsed.success) {
    // Only `days` goes through the repair path, on purpose. It's the one
    // structurally-complex field, and it's the one Claude was observed
    // double-encoding. The scalar metadata fields are handled by the schema
    // instead (z.coerce on the number, .catch() on the enum) -- running them
    // through JSON.parse would turn a legitimately numeric-looking label like
    // "2024" into a number and fail validation that would otherwise pass.
    parsed = ItineraryOptionDraftSchema.safeParse(coerceStringifiedFields(rawInput, ["days"]));
  }
  if (!parsed.success) {
    console.error(
      `ItineraryAgent raw tool_use.input (variant ${variant.key}):`,
      JSON.stringify(rawInput),
    );
    throw new Error(
      `ItineraryAgent produced an invalid itinerary for variant "${variant.key}": ${parsed.error.message}`,
    );
  }
  return parsed.data;
}
