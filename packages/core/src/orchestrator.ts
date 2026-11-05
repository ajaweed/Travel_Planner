// Orchestrator: the one place that sequences Concierge -> Itinerary ->
// Booking -> Budget -> Notification. apps/web's API routes should only ever
// call functions from this file, never reach into an individual agent or
// packages/integrations directly (see frontend-dev.md / backend-dev.md).
//
// Planning is a two-stage flow: generateItineraryOptions() drafts 2-3 options
// and parks the trip in CHOOSING, then selectItineraryOption() materializes
// the one the user picked and starts booking it. Nothing is ever booked
// against an option the user didn't choose.

import { prisma } from "@trip-planner/db";
import { runConciergeAgent } from "./agents/conciergeAgent";
import { ITINERARY_VARIANTS, runItineraryAgent } from "./agents/itineraryAgent";
import { runBookingAgent, type BookableItem } from "./agents/bookingAgent";
import { getBudgetStatus, recordBudgetEntry } from "./agents/budgetAgent";
import { notify } from "./agents/notificationAgent";
import { attachRealReviews } from "./reviewLookup";
import type {
  EnrichedItineraryDayDraft,
  StoredItineraryOption,
  TripBrief,
} from "./agents/types";

/**
 * Failures the caller (an API route) has to turn into distinct HTTP responses
 * rather than a generic 500 -- each one is a different thing the user needs
 * told (see qa-tester.md on provider/flow failure paths).
 */
export type OrchestratorErrorCode = "OPTION_NOT_FOUND" | "OPTION_ALREADY_CHOSEN";

export class OrchestratorError extends Error {
  constructor(
    readonly code: OrchestratorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OrchestratorError";
  }
}

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
  await generateItineraryOptions(trip.id);
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
  await generateItineraryOptions(tripId);
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

/**
 * Stage 1 of planning: draft several candidate itineraries, attach real
 * ratings to the places they name, persist them as ItineraryOption rows, and
 * park the trip in CHOOSING. No ItineraryDay/Activity/Booking row is written
 * and no provider is called for a booking here.
 */
export async function generateItineraryOptions(tripId: string): Promise<void> {
  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
  const brief: TripBrief = JSON.parse(trip.briefJson);

  await prisma.trip.update({ where: { id: tripId }, data: { status: "PLANNING" } });

  // One call per variant, in parallel. allSettled, not all: a single variant
  // failing (bad tool JSON, truncation) should cost the user one option, not
  // the whole trip.
  const settled = await Promise.allSettled(
    ITINERARY_VARIANTS.map((variant) => runItineraryAgent(brief, variant)),
  );

  const drafts = [];
  for (const [index, outcome] of settled.entries()) {
    if (outcome.status === "fulfilled") {
      drafts.push(outcome.value);
    } else {
      console.error(
        `generateItineraryOptions: variant "${ITINERARY_VARIANTS[index]?.key}" failed for trip ${tripId}:`,
        outcome.reason,
      );
    }
  }

  if (drafts.length === 0) {
    await prisma.trip.update({ where: { id: tripId }, data: { status: "NEEDS_ATTENTION" } });
    await notify({
      tripId,
      kind: "GENERAL",
      message:
        "We couldn't draft itinerary options for this trip just now. Nothing has been booked. " +
        "Try describing the trip again, or adjust the dates/budget.",
    });
    return;
  }

  const stored = await attachRealReviews(drafts, brief.destinations.join(", "));

  await persistOptions(tripId, trip.currency, stored);

  await notify({
    tripId,
    kind: "ITINERARY_READY",
    message:
      drafts.length === 1
        ? "Your itinerary is ready to review. Choose it to start booking."
        : `${drafts.length} itinerary options are ready. Pick the one you want and we'll start booking it.`,
  });

  await prisma.trip.update({ where: { id: tripId }, data: { status: "CHOOSING" } });
}

async function persistOptions(
  tripId: string,
  currency: string,
  options: StoredItineraryOption[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Regenerating replaces the previous proposals rather than stacking a
    // second set of optionIndex 0..n (which the unique index would reject).
    await tx.itineraryOption.deleteMany({ where: { tripId } });
    for (const [optionIndex, option] of options.entries()) {
      await tx.itineraryOption.create({
        data: {
          tripId,
          optionIndex,
          status: "PROPOSED",
          label: option.label,
          summary: option.summary,
          pace: option.pace,
          estimatedTotalCents: option.estimatedTotalCents,
          currency,
          draftJson: JSON.stringify(option),
        },
      });
    }
  });
}

/** The options a user is currently choosing between, in display order. */
export async function listItineraryOptions(tripId: string) {
  const rows = await prisma.itineraryOption.findMany({
    where: { tripId },
    orderBy: { optionIndex: "asc" },
  });

  return rows.map((row) => ({
    id: row.id,
    optionIndex: row.optionIndex,
    status: row.status,
    label: row.label,
    summary: row.summary,
    pace: row.pace,
    estimatedTotalCents: row.estimatedTotalCents,
    currency: row.currency,
    draft: JSON.parse(row.draftJson) as StoredItineraryOption,
  }));
}

/**
 * Stage 2 of planning: the user picked an option. Materialize it into the real
 * ItineraryDay/Activity/Booking rows and run the same sequential booking loop
 * as before.
 *
 * The CHOOSING -> BOOKING transition is a conditional update used as a lock:
 * two concurrent "choose this plan" clicks would otherwise both materialize
 * the itinerary and double-book every item. Only the update that actually
 * flips the status proceeds.
 */
export async function selectItineraryOption(tripId: string, optionId: string): Promise<void> {
  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
  const option = await prisma.itineraryOption.findUnique({ where: { id: optionId } });
  if (!option || option.tripId !== tripId) {
    throw new OrchestratorError(
      "OPTION_NOT_FOUND",
      `Itinerary option ${optionId} does not exist on trip ${tripId}.`,
    );
  }

  const claimed = await prisma.trip.updateMany({
    where: { id: tripId, status: "CHOOSING" },
    data: { status: "BOOKING" },
  });
  if (claimed.count === 0) {
    throw new OrchestratorError(
      "OPTION_ALREADY_CHOSEN",
      "A plan has already been chosen for this trip; booking is underway or finished.",
    );
  }

  const brief: TripBrief = JSON.parse(trip.briefJson);
  const draft = JSON.parse(option.draftJson) as StoredItineraryOption;

  let bookableItems: BookableItem[];
  try {
    bookableItems = await materializeItinerary(tripId, brief, draft.days);

    await prisma.$transaction([
      prisma.itineraryOption.update({
        where: { id: optionId },
        data: { status: "SELECTED" },
      }),
      prisma.itineraryOption.updateMany({
        where: { tripId, id: { not: optionId } },
        data: { status: "DISCARDED" },
      }),
    ]);
  } catch (err) {
    // We already claimed the trip by flipping it to BOOKING. If writing the
    // plan failed, release the claim so the user gets their options back
    // instead of a trip stuck in BOOKING with no itinerary forever. Safe to
    // retry: materializeItinerary is a single transaction, so nothing partial
    // was persisted.
    await prisma.trip.update({ where: { id: tripId }, data: { status: "CHOOSING" } });
    throw err;
  }

  await notify({
    tripId,
    kind: "ITINERARY_READY",
    message: `"${option.label}" it is. Now booking flights, hotels, and activities.`,
  });

  await runBookingPipeline(bookableItems);
  await finalizeTripStatus(tripId);
}

/**
 * Writes a chosen plan's days/activities/bookings. This is the persistence
 * half of what used to be planTrip(), unchanged in behaviour -- bookings are
 * created in SEARCHING with a pending idempotency key and handed to the
 * booking loop as BookableItems.
 */
async function materializeItinerary(
  tripId: string,
  brief: TripBrief,
  days: EnrichedItineraryDayDraft[],
): Promise<BookableItem[]> {
  const bookableItems: BookableItem[] = [];

  await prisma.$transaction(async (tx) => {
    for (const day of days) {
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

  return bookableItems;
}

/**
 * Sequential on purpose: each booking's budget check depends on the running
 * total committed/pending from everything booked before it.
 */
async function runBookingPipeline(items: BookableItem[]): Promise<void> {
  for (const item of items) {
    await processBooking(item);
  }
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
