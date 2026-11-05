// ConciergeAgent: turns a free-text trip request into a structured
// TripBrief. Asks exactly one clarifying question when something required
// is genuinely missing/ambiguous — never interrogates for things it can
// reasonably infer or default (see backend-dev.md).

import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { AGENT_MODEL, getClaudeClient } from "../claudeClient";
import { coerceStringifiedFields } from "./toolInputRepair";
import { ConciergeResultSchema, type ConciergeResult, type TripBrief } from "./types";

const ARRAY_FIELDS = ["destinations", "interests", "mustInclude", "mustAvoid"];

const tools: Tool[] = [
  {
    name: "record_trip_brief",
    description:
      "Record a complete, structured trip brief extracted from the user's request. Only call this when you have enough to start planning — infer reasonable defaults (e.g. pace, interests) rather than leaving this incomplete.",
    input_schema: {
      type: "object",
      properties: {
        destinations: { type: "array", items: { type: "string" }, minItems: 1 },
        originCity: { type: "string" },
        startDate: { type: "string", description: "YYYY-MM-DD" },
        endDate: { type: "string", description: "YYYY-MM-DD" },
        flexibleDates: { type: "boolean" },
        durationDays: { type: "integer" },
        partySize: { type: "integer", minimum: 1 },
        travelingWith: { type: "string" },
        budgetTotalCents: { type: "integer", minimum: 0 },
        currency: { type: "string" },
        pace: { type: "string", enum: ["relaxed", "balanced", "packed"] },
        interests: { type: "array", items: { type: "string" } },
        mustInclude: { type: "array", items: { type: "string" } },
        mustAvoid: { type: "array", items: { type: "string" } },
        needsFlights: { type: "boolean" },
        needsHotel: { type: "boolean" },
        openToRecommendations: { type: "boolean" },
      },
      required: ["destinations", "budgetTotalCents"],
    },
  },
  {
    name: "ask_clarifying_question",
    description:
      "Ask the user exactly one question because a required field (destination, dates/duration, or budget) is missing or ambiguous and cannot be reasonably defaulted.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string" },
        partialBrief: { type: "object", description: "Whatever fields you could already extract." },
      },
      required: ["question"],
    },
  },
];

const SYSTEM_PROMPT = `You are the concierge for a trip-planning app. Users range from
"book me LIS->OPO on March 3rd, budget $1500" to "I don't know, surprise me, I just want
to relax somewhere warm for a week, maybe $2000". Your job is to produce a usable
TripBrief without being a form the user has to fill out.

Rules:
- If the user expresses openness/uncertainty ("surprise me", "I don't know what I want"),
  set openToRecommendations=true and go ahead and pick sensible defaults (destination
  suggestions go in mustInclude/interests as hints for the itinerary agent, not as a
  blocking question).
- startDate must always end up as a real YYYY-MM-DD, never left blank and never a vague
  label. If the user gives an exact date, use it. If they give only a vague window ("in
  March", "sometime this summer"), DEFAULT to a specific reasonable date inside that window
  (e.g. the 15th of the stated month) AND set flexibleDates=true so downstream agents know
  it was a guess. Only ask a clarifying question if there is no usable window at all (no
  month, no season, nothing).
- If needsFlights is true (the default), originCity is REQUIRED -- it's what BookingAgent
  actually searches flights from, and "home city" is not a real airport. If the user's
  request doesn't say where they're flying from, this is one of the few things you must
  actually ask about rather than default (don't guess a city).
- Only ask a clarifying question for something you truly cannot infer AND that blocks
  planning: no usable destination at all, no usable budget, no usable date/duration window,
  or (when needsFlights) no origin city. Everything else gets a reasonable default.
- Budget must become an integer number of minor currency units (cents). "$1500" -> 150000.
- Always call exactly one tool.`;

export async function runConciergeAgent(
  userPrompt: string,
  conversationSoFar: Array<{ role: "user" | "assistant"; content: string }> = [],
): Promise<ConciergeResult> {
  const client = getClaudeClient();

  const res = await client.messages.create({
    model: AGENT_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools,
    tool_choice: { type: "any" },
    messages: [
      ...conversationSoFar.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: userPrompt },
    ],
  });

  const toolUse = res.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("ConciergeAgent did not produce a tool call.");
  }

  const buildRaw = (input: Record<string, unknown>) =>
    toolUse.name === "record_trip_brief"
      ? { status: "complete" as const, brief: coerceStringifiedFields(input, ARRAY_FIELDS) }
      : {
          status: "needs_clarification" as const,
          question: (input as { question: string }).question,
          partialBrief: coerceStringifiedFields(
            ((input as { partialBrief?: unknown }).partialBrief as Record<string, unknown>) ?? {},
            ARRAY_FIELDS,
          ),
        };

  let parsed = ConciergeResultSchema.safeParse(buildRaw(toolUse.input as Record<string, unknown>));
  if (!parsed.success) {
    // The LLM's tool call didn't match our schema even after repairing the known
    // double-encoding quirk (see toolInputRepair.ts) -- e.g. missing a required
    // field it should have asked about instead. Fail loud rather than silently
    // coercing further.
    throw new Error(`ConciergeAgent produced an invalid brief: ${parsed.error.message}`);
  }
  return parsed.data;
}

export type { TripBrief };
