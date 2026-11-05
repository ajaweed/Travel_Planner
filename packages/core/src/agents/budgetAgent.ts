// BudgetAgent: deliberately NOT an LLM call. Money math is deterministic --
// see qa-tester.md's #1 priority. This is the single place that computes
// "can we afford this" and "where do we stand," called by the orchestrator
// before and after every booking attempt.

import { prisma } from "@trip-planner/db";
import type { BudgetStatus } from "./types";

export async function getBudgetStatus(tripId: string): Promise<BudgetStatus> {
  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
  const bookings = await prisma.booking.findMany({ where: { tripId } });

  const committedCents = bookings
    .filter((b) => b.status === "BOOKED")
    .reduce((sum, b) => sum + (b.priceCents ?? 0), 0);

  const pendingCents = bookings
    .filter((b) => b.status === "AWAITING_CONFIRMATION" || b.status === "OPTIONS_FOUND")
    .reduce((sum, b) => sum + (b.priceCents ?? 0), 0);

  const remainingCents = trip.budgetTotalCents - committedCents - pendingCents;

  return {
    budgetTotalCents: trip.budgetTotalCents,
    committedCents,
    pendingCents,
    remainingCents,
    currency: trip.currency,
    overBudget: remainingCents < 0,
  };
}

/** Records an actual spend/refund against the trip's running total. */
export async function recordBudgetEntry(params: {
  tripId: string;
  label: string;
  amountCents: number; // positive = spend, negative = refund
  currency: string;
  bookingId?: string;
}): Promise<void> {
  await prisma.$transaction([
    prisma.budgetEntry.create({ data: params }),
    prisma.trip.update({
      where: { id: params.tripId },
      data: { budgetSpentCents: { increment: params.amountCents } },
    }),
  ]);
}
