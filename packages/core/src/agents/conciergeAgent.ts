// ConciergeAgent: turns a free-text trip request into a structured
// TripBrief. Asks exactly one clarifying question when something required
// is genuinely missing/ambiguous — never interrogates for things it can
// reasonably infer or default (see backend-dev.md).

import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { AGENT_MODEL, getClaudeClient } from "../claudeClient";
import { coerceStringifiedFields } from "./toolInputRepair";
import { rollBriefForward, todayISO } from "./tripDates";
import { ConciergeResultSchema, type ConciergeResult, type TripBrief } from "./types";

// Fields Claude has been seen to double-encode as JSON strings (repaired before validation).
const ARRAY_FIELDS = ["destinations", "interests", "mustInclude", "mustAvoid", "dietary", "outdoors"];

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
        dietary: {
          type: "object",
          description:
            "Food needs the traveller states for anyone in the party. Empty when none are mentioned -- never guess (do not infer halal/kosher from a name or destination).",
          properties: {
            requirements: {
              type: "array",
              items: {
                type: "string",
                enum: ["halal", "kosher", "vegetarian", "vegan", "pescatarian", "gluten_free", "dairy_free", "no_pork", "no_alcohol"],
              },
            },
            allergies: {
              type: "array",
              items: { type: "string" },
              description: "Allergens in plain words, e.g. \"peanuts\", \"tree nuts\", \"shellfish\", \"sesame\".",
            },
            notes: { type: "string", description: "Any other food need in the traveller's words (e.g. 'no spicy food')." },
          },
        },
        outdoors: {
          type: "object",
          description:
            "Fitness and access limits the traveller states for walks, hikes and nature outings. Empty when none are mentioned -- never guess from age or anything else.",
          properties: {
            maxDifficulty: {
              type: "string",
              enum: ["easy", "moderate", "hard"],
              description: "The hardest outing they want: 'easy' for gentle walks only, 'hard' if they want challenging hikes.",
            },
            access: {
              type: "array",
              items: { type: "string", enum: ["limited_mobility", "young_kids", "wheelchair"] },
            },
            notes: { type: "string", description: "Any other fitness/access need in their words (e.g. 'afraid of heights')." },
          },
        },
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

const BASE_SYSTEM_PROMPT = `You are the concierge for a trip-planning app. Users range from
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
- Record fitness/access needs for outdoor activities exactly as stated ("nothing too
  strenuous", "bad knees", "with a toddler", "love challenging hikes"). Never ask about them.
- Record dietary needs exactly as stated (halal, kosher, vegetarian, allergies...). Never
  ask about them and never infer them from anything else; a missing dietary need is not a
  reason for a clarifying question.
- Always call exactly one tool.`;

function systemPrompt(today: string): string {
  return `${BASE_SYSTEM_PROMPT}

Today's date is ${today}. Every trip is in the future: when the user gives a month or date
without a year, use its next occurrence on or after today (e.g. "March" asked in November
means March of next year). startDate must never be before ${today}.`;
}

export async function runConciergeAgent(
  userPrompt: string,
  conversationSoFar: Array<{ role: "user" | "assistant"; content: string }> = [],
): Promise<ConciergeResult> {
  const client = getClaudeClient();
  const today = todayISO();

  const res = await client.messages.create({
    model: AGENT_MODEL,
    max_tokens: 1024,
    system: systemPrompt(today),
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
  // Belt and braces: the prompt asks for future dates, but a past startDate
  // would poison every downstream search, so enforce it deterministically.
  const result = parsed.data;
  return result.status === "complete"
    ? { ...result, brief: rollBriefForward(result.brief, today) }
    : { ...result, partialBrief: rollBriefForward(result.partialBrief, today) };
}

export type { TripBrief };
