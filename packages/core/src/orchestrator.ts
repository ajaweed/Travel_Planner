// Orchestrator: the one place that sequences Concierge -> Itinerary ->
// Booking -> Budget -> Notification. apps/web's API routes should only ever
// call functions from this file, never reach into an individual agent or
// packages/integrations directly (see frontend-dev.md / backend-dev.md).

import { prisma } from "@trip-planner/db";
import { runConciergeAgent } from "./agents/conciergeAgent";
import { runItineraryAgent } from "./agents/itineraryAgent";
import { runBookingAgent, type BookableItem } from "./agents/bookingAgent";
import { getBudgetStatus, recordBudgetEntry } from "./agents/budgetAgent";
import { notify } from "./agents/notificationAgent";
import type { TripBrief } from "./agents/types";

export async function startTrip(userId: string, rawPrompt: string) {
  const result = await runConciergeAgent(rawPrompt);

  if (result.status === "needs_clarification") {
    const trip = await prisma.trip.create({
      data: {
        userId,
        rawPrompt,
        briefJson: JSON.stringify(result.partialBrief),
        budgetTotalCents: result.partialBrief.budgetTotalCents ?? 0,
        currency: result.partialBrief.currency ?? "USD",
        status: "DRAFT",
      },
    });
    await notify({ tripId: trip.id, kind: "CLARIFICATION_NEEDED", message: result.question });
    return { trip, needsClarification: true as const, question: result.question };
  }

  const trip = await createTripFromBrief(userId, rawPrompt, result.brief);
  await planTrip(trip.id);
  return { trip, needsClarification: false as const };
}

export async function answerClarification(tripId: string, userReply: string) {
  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
  const result = await runConciergeAgent(userReply, [
    { role: "user", content: trip.rawPrompt },
    { role: "assistant", content: `Partial brief so far: ${trip.briefJson}` },
  ]);

  if (result.status === "needs_clarification") {
    await prisma.trip.update({
      where: { id: tripId },
      data: { briefJson: JSON.stringify(result.partialBrief) },
    });
    await notify({ tripId, kind: "CLARIFICATION_NEEDED", message: result.question });
    return { needsClarification: true as const, question: result.question };
  }

  await prisma.trip.update({
    where: { id: tripId },
    data: {
      briefJson: JSON.stringify(result.brief),
      budgetTotalCents: result.brief.budgetTotalCents,
      currency: result.brief.currency,
      status: "PLANNING",
    },
  });
  await planTrip(tripId);
  return { needsClarification: false as const };
}

async function createTripFromBrief(userId: string, rawPrompt: string, brief: TripBrief) {
  return prisma.trip.create({
    data: {
      userId,
      rawPrompt,
      briefJson: JSON.stringify(brief),
      budgetTotalCents: brief.budgetTotalCents,
      currency: brief.currency,
      startDate: brief.startDate ? new Date(brief.startDate) : null,
      endDate: brief.endDate ? new Date(brief.endDate) : null,
      title: brief.destinations.join(", "),
      status: "PLANNING",
    },
  });
}

/** Itinerary generation + persistence + kicking off bookings for bookable items. */
export async function planTrip(tripId: string): Promise<void> {
  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
  const brief: TripBrief = JSON.parse(trip.briefJson);

  const draft = await runItineraryAgent(brief);

  const bookableItems: BookableItem[] = [];

  await prisma.$transaction(async (tx) => {
    for (const day of draft.days) {
      const itineraryDay = await tx.itineraryDay.create({
        data: {
          tripId,
          dayIndex: day.dayIndex,
          date: day.date ? new Date(day.date) : null,
          summary: day.summary,
        },
      });

      for (const [order, activity] of day.activities.entries()) {
        let bookingId: string | undefined;

        if (activity.bookable) {
          const booking = await tx.booking.create({
            data: {
              tripId,
              kind: activity.bookable.kind,
              status: "SEARCHING",
              provider: "", // filled in once BookingAgent resolves a provider
              idempotencyKey: `pending_${itineraryDay.id}_${order}`,
              searchParamsJson: JSON.stringify({ searchHint: activity.bookable.searchHint }),
            },
          });
          bookingId = booking.id;
          bookableItems.push({
            bookingId: booking.id,
            kind: activity.bookable.kind,
            searchHint: activity.bookable.searchHint,
            tripContext: {
              destinations: brief.destinations,
              originCity: brief.originCity,
              startDate: brief.startDate,
              endDate: brief.endDate,
              partySize: brief.partySize,
            },
          });
        }

        await tx.activity.create({
          data: {
            itineraryDayId: itineraryDay.id,
            order,
            title: activity.title,
            description: activity.description,
            startTime: activity.startTime,
            endTime: activity.endTime,
            bookingId,
          },
        });
      }
    }
  });

  await notify({
    tripId,
    kind: "ITINERARY_READY",
    message: "Your itinerary is ready. Now booking flights, hotels, and activities.",
  });

  await prisma.trip.update({ where: { id: tripId }, data: { status: "BOOKING" } });

  // Sequential on purpose: each booking's budget check depends on the
  // running total committed/pending from everything booked before it.
  for (const item of bookableItems) {
    await processBooking(item);
  }

  await finalizeTripStatus(tripId);
}

async function processBooking(item: BookableItem): Promise<void> {
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: item.bookingId } });
  const budgetStatus = await getBudgetStatus(booking.tripId);

  const outcome = await runBookingAgent(item, budgetStatus);

  if (outcome.status === "BOOKED") {
    await prisma.booking.update({
      where: { id: item.bookingId },
      data: {
        status: "BOOKED",
        providerRef: outcome.providerRef,
        provider: outcome.provider,
        priceCents: outcome.priceCents,
        currency: outcome.currency,
        idempotencyKey: `booking_${item.bookingId}`,
      },
    });
    await recordBudgetEntry({
      tripId: booking.tripId,
      label: `${item.kind} booking confirmed`,
      amountCents: outcome.priceCents,
      currency: outcome.currency,
      bookingId: item.bookingId,
    });
    await notify({
      tripId: booking.tripId,
      kind: "BOOKING_CONFIRMED",
      message: `Booked: ${item.searchHint} (confirmation ${outcome.providerRef}).`,
    });
    return;
  }

  if (outcome.status === "AWAITING_CONFIRMATION") {
    await prisma.booking.update({
      where: { id: item.bookingId },
      data: {
        status: "AWAITING_CONFIRMATION",
        priceCents: outcome.priceCents,
        currency: outcome.currency,
      },
    });
    await notify({
      tripId: booking.tripId,
      kind: "BUDGET_ALERT",
      message: `A ${item.kind.toLowerCase()} for "${item.searchHint}" would cost ${formatMoney(
        outcome.priceCents,
        outcome.currency,
      )}, which exceeds your remaining budget. Raise your budget or choose a cheaper option to continue.`,
    });
    return;
  }

  await prisma.booking.update({
    where: { id: item.bookingId },
    data: { status: "FAILED", failureReason: outcome.reason },
  });
  await notify({
    tripId: booking.tripId,
    kind: "BOOKING_FAILED",
    message: `Couldn't book "${item.searchHint}": ${outcome.reason}`,
  });
}

async function finalizeTripStatus(tripId: string): Promise<void> {
  const bookings = await prisma.booking.findMany({ where: { tripId } });
  const anyNeedsAttention = bookings.some(
    (b) => b.status === "FAILED" || b.status === "AWAITING_CONFIRMATION",
  );
  await prisma.trip.update({
    where: { id: tripId },
    data: { status: anyNeedsAttention ? "NEEDS_ATTENTION" : "CONFIRMED" },
  });
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}
