// BookingAgent: given one bookable item from the itinerary (a searchHint +
// kind), runs an agentic tool-use loop to search real providers, check the
// price against remaining budget BEFORE committing, and book.
//
// Money/idempotency/ordering rules here mirror backend-dev.md: budget is
// checked before any book_* call, and every book_* call carries a stable
// idempotencyKey derived from the booking row so retries can't double-book.

import type { MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages";
import { AGENT_MODEL, getClaudeClient } from "../claudeClient";
import { bookingTools, runBookingTool } from "../tools/bookingTools";
import type { BudgetStatus } from "./types";

export type BookableItem = {
  bookingId: string; // our own Booking.id — becomes the idempotency key seed
  kind: "FLIGHT" | "HOTEL" | "TOUR" | "RESERVATION";
  searchHint: string;
  tripContext: {
    destinations: string[];
    originCity?: string;
    startDate?: string;
    endDate?: string;
    partySize: number;
  };
};

export type BookingOutcome =
  | { status: "BOOKED"; providerRef: string; priceCents: number; currency: string; provider: string }
  | { status: "FAILED"; reason: string }
  | { status: "AWAITING_CONFIRMATION"; reason: "BUDGET_EXCEEDED"; priceCents: number; currency: string };

const checkBudgetTool: Tool = {
  name: "check_budget_ok",
  description:
    "Check whether committing a purchase of the given amount would stay within the trip's remaining budget. MUST be called with the real offer price before calling any book_* tool.",
  input_schema: {
    type: "object",
    properties: {
      amountCents: { type: "integer", minimum: 0 },
      currency: { type: "string" },
    },
    required: ["amountCents", "currency"],
  },
};

const SYSTEM_PROMPT = `You are the booking agent for a trip-planning app. You're given one
bookable item (a flight, hotel, tour, or reservation) with a search hint and trip context.

Procedure, strictly in order:
1. Call the matching search_* tool for this item's kind.
2. If it returns NO_AVAILABILITY, try at most one reasonable variation (e.g. adjacent date)
   before giving up and reporting failure in plain text -- do not loop indefinitely.
3. Once you have a candidate offer, call check_budget_ok with its exact price BEFORE booking.
   If it says the budget would be exceeded, STOP -- report back in plain text that this needs
   the user's attention (raise budget / pick a cheaper option). Do not book over budget.
4. Only if budget is OK, call the matching book_* tool for the chosen offer, passing through
   the offer's raw data and the provided idempotencyKey unchanged.
5. After a book_* call succeeds or fails, stop and summarize the outcome in plain text --
   don't keep calling tools after you have a final result.

Never fabricate a provider confirmation, price, or availability. If a tool returns
NOT_CONFIGURED, report that plainly -- it means this provider isn't wired up yet, not that
the booking failed for a business reason.`;

export async function runBookingAgent(
  item: BookableItem,
  budgetStatus: BudgetStatus,
): Promise<BookingOutcome> {
  const client = getClaudeClient();
  const tools: Tool[] = [...bookingTools, checkBudgetTool];
  const idempotencyKey = `booking_${item.bookingId}`;

  const messages: MessageParam[] = [
    {
      role: "user",
      content: JSON.stringify({
        item: { kind: item.kind, searchHint: item.searchHint },
        tripContext: item.tripContext,
        idempotencyKey,
        budgetRemainingCents: budgetStatus.remainingCents,
        currency: budgetStatus.currency,
      }),
    },
  ];

  const MAX_TURNS = 6;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await client.messages.create({
      model: AGENT_MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    messages.push({ role: "assistant", content: res.content });

    const toolUses = res.content.filter((b) => b.type === "tool_use");
    if (toolUses.length === 0) {
      // Agent produced a final plain-text summary without booking/failing explicitly.
      return { status: "FAILED", reason: extractText(res.content) || "No booking outcome produced." };
    }

    const toolResults = [];
    for (const toolUse of toolUses) {
      if (toolUse.type !== "tool_use") continue;

      if (toolUse.name === "check_budget_ok") {
        const input = toolUse.input as { amountCents: number; currency: string };
        const wouldExceed = input.amountCents > budgetStatus.remainingCents;
        if (wouldExceed) {
          return {
            status: "AWAITING_CONFIRMATION",
            reason: "BUDGET_EXCEEDED",
            priceCents: input.amountCents,
            currency: input.currency,
          };
        }
        toolResults.push({
          type: "tool_result" as const,
          tool_use_id: toolUse.id,
          content: JSON.stringify({ ok: true, withinBudget: true }),
        });
        continue;
      }

      const result = await runBookingTool(toolUse.name, toolUse.input as Record<string, unknown>);
      const outcome = extractBookingOutcome(toolUse.name, result);
      if (outcome) return outcome;

      toolResults.push({
        type: "tool_result" as const,
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return { status: "FAILED", reason: "Booking agent exceeded max turns without a conclusive outcome." };
}

function extractText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join(" ")
    .trim();
}

/** If this was a book_* call, short-circuit the loop with the final outcome. */
function extractBookingOutcome(toolName: string, result: unknown): BookingOutcome | null {
  if (!toolName.startsWith("book_")) return null;
  const r = result as { ok: boolean; reason?: string; message?: string; data?: unknown };
  if (r.ok) {
    const data = r.data as { providerRef: string; price: { amountCents: number; currency: string } };
    return {
      status: "BOOKED",
      providerRef: data.providerRef,
      priceCents: data.price.amountCents,
      currency: data.price.currency,
      provider: toolName.replace("book_", ""),
    };
  }
  return { status: "FAILED", reason: r.message ?? r.reason ?? "Unknown booking failure." };
}
