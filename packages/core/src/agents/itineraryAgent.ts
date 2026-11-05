// ItineraryAgent: turns a confirmed TripBrief into a day-by-day plan.
// Leaves bookable items (flights/hotels/tours) as *placeholders* with a
// searchHint for BookingAgent — it never invents a confirmed booking itself.

import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { AGENT_MODEL, getClaudeClient } from "../claudeClient";
import { coerceStringifiedFields } from "./toolInputRepair";
import { ItineraryDraftSchema, type ItineraryDraft, type TripBrief } from "./types";

const tools: Tool[] = [
  {
    name: "record_itinerary",
    description: "Record the full day-by-day itinerary for the trip.",
    input_schema: {
      type: "object",
      properties: {
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
                      },
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
      required: ["days"],
    },
  },
];

const SYSTEM_PROMPT = `You are the itinerary planner for a trip-planning app. You receive a
structured TripBrief (destination(s), dates, budget, party, pace, interests) and produce a
day-by-day itinerary.

Rules:
- Match the requested pace: "relaxed" means 2-3 activities/day with real downtime,
  "packed" means a full day scheduled start to finish.
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
- Restaurant/dining reservations are NOT bookable -- there is no reservation provider wired
  up yet (see architect.md). Write them as plain narrative activities with no 'bookable'
  field at all; do not set kind: "RESERVATION".
- Every ItineraryDay's 'date' field must be a real YYYY-MM-DD computed from brief.startDate +
  dayIndex. If brief.startDate is missing/not a real date, leave 'date' unset entirely --
  never put a placeholder like "Day 1" in a date field.
- Respect mustInclude and mustAvoid literally. Respect budget directionally -- don't plan an
  itinerary implying obviously-unaffordable choices (e.g. 5-star hotels on a shoestring
  budget) -- but exact pricing is BookingAgent's job, not yours.
- Always call record_itinerary exactly once with the full plan.`;

export async function runItineraryAgent(brief: TripBrief): Promise<ItineraryDraft> {
  const client = getClaudeClient();

  const res = await client.messages.create({
    model: AGENT_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools,
    tool_choice: { type: "tool", name: "record_itinerary" },
    messages: [{ role: "user", content: JSON.stringify(brief) }],
  });

  const toolUse = res.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("ItineraryAgent did not produce a tool call.");
  }

  const rawInput = toolUse.input as Record<string, unknown>;
  let parsed = ItineraryDraftSchema.safeParse(rawInput);
  if (!parsed.success) {
    parsed = ItineraryDraftSchema.safeParse(coerceStringifiedFields(rawInput, ["days"]));
  }
  if (!parsed.success) {
    console.error("ItineraryAgent raw tool_use.input:", JSON.stringify(rawInput));
    throw new Error(`ItineraryAgent produced an invalid itinerary: ${parsed.error.message}`);
  }
  return parsed.data;
}
