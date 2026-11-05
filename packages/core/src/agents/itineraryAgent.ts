// ItineraryAgent: turns a confirmed TripBrief into a day-by-day plan.
// Leaves bookable items (flights/hotels/tours) as *placeholders* with a
// searchHint for BookingAgent — it never invents a confirmed booking itself.

import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { AGENT_MODEL, getClaudeClient } from "../claudeClient";
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
                      properties: {
                        kind: { type: "string", enum: ["FLIGHT", "HOTEL", "TOUR", "RESERVATION"] },
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
- Every day needs exactly one HOTEL bookable activity implied by the stay (don't repeat a
  hotel search per day; put it on day 0 as check-in and the last day as check-out) and, if
  needsFlights is true, a FLIGHT bookable activity on day 0 (arrival) and the final day
  (departure).
- Tours/reservations are bookable: { kind: "TOUR" | "RESERVATION", searchHint }. Give enough
  detail in searchHint for a search agent with no other context to find the right thing
  (destination, rough date, what kind of activity).
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

  const parsed = ItineraryDraftSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(`ItineraryAgent produced an invalid itinerary: ${parsed.error.message}`);
  }
  return parsed.data;
}
