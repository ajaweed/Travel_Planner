// Orchestrator: the one place that sequences Concierge -> Itinerary ->
// Booking -> Budget -> Notification. apps/web's API routes should only ever
// call functions from this file, never reach into an individual agent or
// packages/integrations directly (see frontend-dev.md / backend-dev.md).
//
// Planning is a two-stage flow: generateItineraryOptions() drafts 2-3 options
// and parks the trip in CHOOSING, then selectItineraryOption() materializes
// the one the user picked and starts booking it. Nothing is ever booked
// against an option the user didn't choose.

import { prisma, type BookingMode } from "@trip-planner/db";
import { runConciergeAgent } from "./agents/conciergeAgent";
import { ITINERARY_VARIANTS, runItineraryAgent } from "./agents/itineraryAgent";
import { destinationFor, type LinkSearchParams } from "./bookingLinks";
import { getAiBookingReadiness } from "./aiBookingReadiness";
import { runBookingAgent, type BookableItem, type BookingOutcome } from "./agents/bookingAgent";
import { getBudgetStatus } from "./agents/budgetAgent";
import { notify } from "./agents/notificationAgent";
import { attachRealReviews } from "./reviewLookup";
import { checkOutdoorPlaces, checkRestaurants } from "./restaurantChecks";
import { checkTrails } from "./trailChecks";
import { dietaryFromBrief, mergeDietary, type Dietary } from "./dietary";
import { mergeOutdoorNeeds, outdoorNeedsFromBrief, type OutdoorNeeds } from "./outdoors";
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
export type OrchestratorErrorCode =
  | "OPTION_NOT_FOUND"
  | "OPTION_ALREADY_CHOSEN"
  | "TRIP_PAST_PLANNING"
  | "AI_BOOKING_UNAVAILABLE";

export class OrchestratorError extends Error {
  constructor(
    readonly code: OrchestratorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OrchestratorError";
  }
}

/**
 * @param dietary what the traveller ticked on the landing page. Merged into
 *   the brief in code -- never left to the model to extract -- and carried
 *   through a clarification round in the stored partial brief.
 */
export async function startTrip(
  userId: string,
  rawPrompt: string,
  dietary?: Partial<Dietary>,
  outdoors?: Partial<OutdoorNeeds>,
) {
  const result = await runConciergeAgent(rawPrompt);

  if (result.status === "needs_clarification") {
    const partialBrief = {
      ...result.partialBrief,
      dietary: mergeDietary(result.partialBrief.dietary, dietary),
      outdoors: mergeOutdoorNeeds(result.partialBrief.outdoors, outdoors),
    };
    const trip = await prisma.trip.create({
      data: {
        userId,
        rawPrompt,
        briefJson: JSON.stringify(partialBrief),
        budgetTotalCents: result.partialBrief.budgetTotalCents ?? 0,
        currency: result.partialBrief.currency ?? "USD",
        status: "DRAFT",
      },
    });
    await notify({ tripId: trip.id, kind: "CLARIFICATION_NEEDED", message: result.question });
    return { trip, needsClarification: true as const, question: result.question };
  }

  const brief = {
    ...result.brief,
    dietary: mergeDietary(result.brief.dietary, dietary),
    outdoors: mergeOutdoorNeeds(result.brief.outdoors, outdoors),
  };
  const trip = await createTripFromBrief(userId, rawPrompt, brief);
  await generateItineraryOptions(trip.id);
  return { trip, needsClarification: false as const };
}

export async function answerClarification(tripId: string, userReply: string) {
  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });

  // Only a trip still awaiting its brief can be (re)planned from a
  // clarification answer. Without this, a stale CLARIFICATION_NEEDED prompt
  // left on screen could re-run planning on a trip that has already chosen an
  // option and spent money -- wiping the chosen option and re-offering
  // options for a trip with live bookings.
  if (trip.status !== "DRAFT" && trip.status !== "PLANNING") {
    throw new OrchestratorError(
      "TRIP_PAST_PLANNING",
      "This trip is past the planning stage, so it can't be re-planned from a clarification answer.",
    );
  }

  const result = await runConciergeAgent(userReply, [
    { role: "user", content: trip.rawPrompt },
    { role: "assistant", content: `Partial brief so far: ${trip.briefJson}` },
  ]);

  // Dietary needs from earlier turns (incl. landing-page ticks) must survive
  // however the model restates the brief.
  const earlierDietary = dietaryFromBrief(trip.briefJson);
  const earlierOutdoors = outdoorNeedsFromBrief(trip.briefJson);

  if (result.status === "needs_clarification") {
    const partialBrief = {
      ...result.partialBrief,
      dietary: mergeDietary(result.partialBrief.dietary, earlierDietary),
      outdoors: mergeOutdoorNeeds(result.partialBrief.outdoors, earlierOutdoors),
    };
    await prisma.trip.update({
      where: { id: tripId },
      data: { briefJson: JSON.stringify(partialBrief) },
    });
    await notify({ tripId, kind: "CLARIFICATION_NEEDED", message: result.question });
    return { needsClarification: true as const, question: result.question };
  }

  const brief = {
    ...result.brief,
    dietary: mergeDietary(result.brief.dietary, earlierDietary),
    outdoors: mergeOutdoorNeeds(result.brief.outdoors, earlierOutdoors),
  };
  await prisma.trip.update({
    where: { id: tripId },
    data: {
      briefJson: JSON.stringify(brief),
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

  // persistOptions() replaces this trip's options wholesale, so running this
  // on a trip that already chose one would delete the SELECTED row out from
  // under a materialized itinerary. Planning stages only.
  if (trip.status !== "DRAFT" && trip.status !== "PLANNING" && trip.status !== "CHOOSING") {
    throw new OrchestratorError(
      "TRIP_PAST_PLANNING",
      `Trip ${tripId} is ${trip.status}; itinerary options can only be generated before one is chosen.`,
    );
  }

  const brief: TripBrief = JSON.parse(trip.briefJson);

  await prisma.trip.update({ where: { id: tripId }, data: { status: "PLANNING" } });

  // One call per variant, in parallel. allSettled, not all: a single variant
  // failing (bad tool JSON, truncation) should cost the user one option, not
  // the whole trip.
  const settled = await Promise.allSettled(
    ITINERARY_VARIANTS.map((variant) => runItineraryAgent(brief, variant)),
  );

  const drafts = [];
  const variantKeys: string[] = [];
  for (const [index, outcome] of settled.entries()) {
    if (outcome.status === "fulfilled") {
      drafts.push(outcome.value);
      variantKeys.push(ITINERARY_VARIANTS[index]!.key);
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

  // attachRealReviews preserves order, so variantKeys[i] belongs to stored[i].
  // Restaurant, outdoor-place and trail checks run alongside (all read-only
  // lookups that never throw).
  const [withReviews, restaurants, outdoorPlaces, trails] = await Promise.all([
    attachRealReviews(drafts, brief.destinations.join(", ")),
    checkRestaurants(drafts, brief.destinations),
    checkOutdoorPlaces(drafts, brief.destinations),
    checkTrails(drafts, brief.destinations),
  ]);
  const stored = withReviews.map((option, i) => ({
    ...option,
    variant: variantKeys[i],
    restaurantChecks: restaurants.perOption[i],
    restaurantLookup: restaurants.status,
    outdoorChecks: outdoorPlaces.perOption[i],
    outdoorLookup: outdoorPlaces.status,
    trailChecks: trails[i],
  }));

  await persistOptions(tripId, trip.currency, stored);

  await notify({
    tripId,
    kind: "ITINERARY_READY",
    message:
      drafts.length === 1
        ? "Your itinerary is ready to review."
        : `${drafts.length} itinerary options are ready. Pick the one you want.`,
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
 * Stage 2 of planning: the user picked an option and said who books it.
 *
 * - "SELF": materialize the plan with every bookable as a LINK_OUT Booking and
 *   move to READY_TO_BOOK. Nothing is booked; the trip page shows provider
 *   search links (bookingLinks.ts) and the traveller books each item.
 * - "AI": materialize with bookables in SEARCHING, move to BOOKING, and run the
 *   BookingAgent over each item (budget-checked, idempotent), then finalize to
 *   CONFIRMED or NEEDS_ATTENTION. Every non-BOOKED item still gets search links
 *   on the trip page, so a failed AI booking is never a dead end.
 *
 * Both modes store the same structured search params on each Booking, which
 * is what makes the link fallback work in AI mode.
 *
 * The CHOOSING -> (READY_TO_BOOK | BOOKING) transition is a conditional update
 * used as a lock: two concurrent "choose this plan" clicks would otherwise
 * both materialize the itinerary and, in AI mode, double-book every item.
 */
export async function selectItineraryOption(
  tripId: string,
  optionId: string,
  mode: BookingMode = "SELF",
): Promise<void> {
  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
  const option = await prisma.itineraryOption.findUnique({ where: { id: optionId } });
  if (!option || option.tripId !== tripId) {
    throw new OrchestratorError(
      "OPTION_NOT_FOUND",
      `Itinerary option ${optionId} does not exist on trip ${tripId}.`,
    );
  }

  // With no provider credentials at all, every AI booking is a guaranteed
  // NOT_CONFIGURED failure after several paid model calls per item -- refuse
  // up front instead of burning API spend on a known outcome.
  if (mode === "AI" && !getAiBookingReadiness().anyConfigured) {
    throw new OrchestratorError(
      "AI_BOOKING_UNAVAILABLE",
      "AI booking isn't available yet: no booking providers are connected. Choose \"I'll book it myself\" to get booking links.",
    );
  }

  const claimed = await prisma.trip.updateMany({
    where: { id: tripId, status: "CHOOSING" },
    data: { status: mode === "AI" ? "BOOKING" : "READY_TO_BOOK", bookingMode: mode },
  });
  if (claimed.count === 0) {
    throw new OrchestratorError(
      "OPTION_ALREADY_CHOSEN",
      "A plan has already been chosen for this trip.",
    );
  }

  const brief: TripBrief = JSON.parse(trip.briefJson);
  const draft = JSON.parse(option.draftJson) as StoredItineraryOption;

  let bookableItems: BookableItem[];
  try {
    bookableItems = await materializeItinerary(tripId, optionId, brief, draft.days, mode);
  } catch (err) {
    // We already claimed the trip. If writing the plan failed, release the
    // claim so the user gets their options back instead of a trip stuck with
    // no itinerary. Safe because materializeItinerary is one transaction:
    // either the whole plan landed or none of it did.
    await prisma.trip.update({
      where: { id: tripId },
      data: { status: "CHOOSING", bookingMode: "SELF" },
    });
    throw err;
  }

  const n = bookableItems.length;
  const things = `${n} thing${n === 1 ? "" : "s"}`;

  if (mode === "SELF") {
    await notify({
      tripId,
      kind: "ITINERARY_READY",
      message:
        n > 0
          ? `"${option.label}" it is. Your plan has ${things} to book -- use the links next to each one to book it yourself.`
          : `"${option.label}" it is. Nothing in this plan needs booking.`,
    });
    return;
  }

  await notify({
    tripId,
    kind: "ITINERARY_READY",
    message:
      n > 0
        ? `"${option.label}" it is. The AI is now booking ${things} for you.`
        : `"${option.label}" it is. Nothing in this plan needs booking.`,
  });
  // The booking pass is several model turns per item, run sequentially --
  // minutes, not milliseconds -- so it must not live inside the HTTP request
  // (proxy/host timeouts would kill it mid-item). It runs detached on this
  // long-lived Node server; the trip page polls for progress, and
  // reapStalledBookings() cleans up if the process dies part-way.
  // NOTE: on a serverless host this needs a real job queue instead.
  void runAiBookingPass(tripId, bookableItems);
}

async function runAiBookingPass(tripId: string, items: BookableItem[]): Promise<void> {
  try {
    await runBookingPipeline(items);
  } catch (err) {
    console.error(`AI booking pass crashed for trip ${tripId}:`, err);
  }
  try {
    await finalizeTripStatus(tripId);
  } catch (err) {
    // Leaves the trip in BOOKING; reapStalledBookings() will finalize it.
    console.error(`Could not finalize trip ${tripId}:`, err);
  }
}

/** How long a BOOKING trip can go without any booking-row progress. */
const STALL_MS = 15 * 60 * 1000;

/**
 * If an AI booking pass died part-way (server restart, crash), the trip would
 * sit in BOOKING with SEARCHING rows forever -- and SEARCHING rows get no
 * fallback links. Called on trip reads: once nothing has moved for STALL_MS,
 * mark the leftover rows FAILED (which gives them links) and finalize.
 * Each item touches its row when it starts, so a long single item still
 * counts as progress.
 */
export async function reapStalledBookings(tripId: string, now: Date = new Date()): Promise<void> {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip || trip.status !== "BOOKING" || trip.bookingMode !== "AI") return;

  const latest = await prisma.booking.findFirst({
    where: { tripId },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });
  const lastProgress = latest?.updatedAt ?? trip.updatedAt;
  if (now.getTime() - lastProgress.getTime() < STALL_MS) return;

  await prisma.booking.updateMany({
    where: { tripId, status: "SEARCHING" },
    data: {
      status: "FAILED",
      failureReason:
        "Booking was interrupted before this item finished. It may not have been booked -- check your email for a confirmation before booking it yourself.",
    },
  });
  await finalizeTripStatus(tripId);
}

/**
 * Writes a chosen plan's days/activities/bookings, and marks which option won,
 * all in ONE transaction. Returns the bookable items (for the AI booking loop;
 * SELF mode only uses the count).
 *
 * The option-status writes belong inside this transaction rather than after
 * it: a trip whose days exist but whose option still reads PROPOSED (or vice
 * versa) is a state nothing else in the system knows how to recover from, and
 * the unique (tripId, dayIndex) index means a naive retry would fail forever.
 */
async function materializeItinerary(
  tripId: string,
  selectedOptionId: string,
  brief: TripBrief,
  days: EnrichedItineraryDayDraft[],
  mode: BookingMode,
): Promise<BookableItem[]> {
  const bookableItems: BookableItem[] = [];
  const isoDate = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  // The brief's dates are concierge output and normally ISO; the day dates
  // are what the itinerary actually uses, so fall back to them per field.
  const tripStart = isoDate(brief.startDate) ?? isoDate(days[0]?.date);
  const tripEnd = isoDate(brief.endDate) ?? isoDate(days[days.length - 1]?.date);

  await prisma.$transaction(async (tx) => {
    await tx.itineraryOption.update({
      where: { id: selectedOptionId },
      data: { status: "SELECTED" },
    });
    await tx.itineraryOption.updateMany({
      where: { tripId, id: { not: selectedOptionId } },
      data: { status: "DISCARDED" },
    });

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
          const searchParams: LinkSearchParams = {
            kind: activity.bookable.kind,
            searchHint: activity.bookable.searchHint,
            title: activity.title,
            candidateName: activity.bookable.candidateName,
            date: day.date,
            originCity: brief.originCity,
            destination:
              activity.bookable.kind === "FLIGHT"
                ? brief.destinations[0] // the round trip is origin <-> the trip's (first) destination
                : destinationFor(
                    brief.destinations,
                    activity.bookable.candidateName,
                    activity.title,
                    activity.bookable.searchHint,
                  ),
            startDate: tripStart,
            endDate: tripEnd,
            partySize: brief.partySize,
          };
          const booking = await tx.booking.create({
            data: {
              tripId,
              kind: activity.bookable.kind,
              ...(mode === "AI"
                ? {
                    status: "SEARCHING",
                    provider: "", // filled in once BookingAgent resolves a provider
                    idempotencyKey: `pending_${itineraryDay.id}_${order}`,
                  }
                : {
                    status: "LINK_OUT",
                    provider: "user", // booked by the traveller on the provider's own site
                    idempotencyKey: `linkout_${itineraryDay.id}_${order}`,
                  }),
              searchParamsJson: JSON.stringify(searchParams),
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
              startDate: tripStart,
              endDate: tripEnd,
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
 *
 * Each item is isolated: runBookingAgent returns FAILED for business outcomes,
 * but an SDK/network throw from the model call would otherwise abort every
 * remaining booking AND skip finalizeTripStatus, leaving the trip in BOOKING
 * with items stuck on SEARCHING forever. One item blowing up costs that item.
 */
async function runBookingPipeline(items: BookableItem[]): Promise<void> {
  for (const item of items) {
    try {
      await processBooking(item);
    } catch (err) {
      console.error(`processBooking failed for booking ${item.bookingId}:`, err);
      await markBookingCrashed(item, err);
    }
  }
}

/**
 * Thrown when the provider confirmed a booking but we then failed to record
 * it. The money is spent: this must never be turned into FAILED, which would
 * offer the user links to book (and pay for) the same thing again.
 */
class BookedButUnrecordedError extends Error {
  constructor(
    readonly outcome: Extract<BookingOutcome, { status: "BOOKED" }>,
    cause: unknown,
  ) {
    super(`Provider booked ${outcome.providerRef} but recording it failed: ${String(cause)}`);
  }
}

async function markBookingCrashed(item: BookableItem, err: unknown): Promise<void> {
  if (err instanceof BookedButUnrecordedError) {
    // One more attempt at the essential fact: it IS booked, with this ref.
    // AWAITING_CONFIRMATION (no links) + an explicit reason if even that
    // fails is handled by the outer catch's log -- never FAILED.
    try {
      await prisma.booking.update({
        where: { id: item.bookingId },
        data: {
          status: "BOOKED",
          providerRef: err.outcome.providerRef,
          provider: err.outcome.provider,
          priceCents: err.outcome.priceCents,
          currency: err.outcome.currency,
        },
      });
    } catch (nested) {
      console.error(
        `CRITICAL: booking ${item.bookingId} was booked with provider (ref ${err.outcome.providerRef}) but could not be recorded:`,
        nested,
      );
    }
    return;
  }

  const reason =
    err instanceof Error ? `Unexpected error while booking: ${err.message}` : "Unexpected error while booking.";
  try {
    // Re-read first: if the row already says BOOKED, the failure came after
    // the money moved (e.g. a notification write) and must not erase that.
    const current = await prisma.booking.findUnique({ where: { id: item.bookingId } });
    if (!current || current.status === "BOOKED") return;
    const booking = await prisma.booking.update({
      where: { id: item.bookingId },
      data: { status: "FAILED", failureReason: reason },
    });
    await notify({
      tripId: booking.tripId,
      kind: "BOOKING_FAILED",
      message: `Couldn't book "${item.searchHint}": ${reason}`,
    });
  } catch (nested) {
    // Nothing left to do but log -- the DB itself is refusing writes.
    console.error(`Could not record the failure for booking ${item.bookingId}:`, nested);
  }
}

async function processBooking(item: BookableItem): Promise<void> {
  // Touch the row as this item starts: it's the progress signal
  // reapStalledBookings() watches.
  const booking = await prisma.booking.update({
    where: { id: item.bookingId },
    data: { status: "SEARCHING" },
  });
  const budgetStatus = await getBudgetStatus(booking.tripId);

  const outcome = await runBookingAgent(item, budgetStatus);

  if (outcome.status === "BOOKED") {
    // The provider has already taken the money. Status + budget entry are
    // written atomically; if that fails it's reported as booked-but-
    // unrecorded, never as a failure (see BookedButUnrecordedError).
    try {
      await recordBookedOutcome(booking.tripId, item, outcome);
    } catch (err) {
      throw new BookedButUnrecordedError(outcome, err);
    }
    // Best effort: a lost notification must not touch the booking itself.
    await notify({
      tripId: booking.tripId,
      kind: "BOOKING_CONFIRMED",
      message: `Booked: ${item.searchHint} (confirmation ${outcome.providerRef}).`,
    }).catch((err) => console.error(`notify failed for booking ${item.bookingId}:`, err));
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
      )}, which is more than your remaining budget, so the AI didn't book it. You can book it yourself with the links on your trip page.`,
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

async function recordBookedOutcome(
  tripId: string,
  item: BookableItem,
  outcome: Extract<BookingOutcome, { status: "BOOKED" }>,
): Promise<void> {
  await prisma.$transaction([
    prisma.booking.update({
      where: { id: item.bookingId },
      data: {
        status: "BOOKED",
        providerRef: outcome.providerRef,
        provider: outcome.provider,
        priceCents: outcome.priceCents,
        currency: outcome.currency,
        idempotencyKey: `booking_${item.bookingId}`,
      },
    }),
    prisma.budgetEntry.create({
      data: {
        tripId,
        label: `${item.kind} booking confirmed`,
        amountCents: outcome.priceCents,
        currency: outcome.currency,
        bookingId: item.bookingId,
      },
    }),
    prisma.trip.update({
      where: { id: tripId },
      data: { budgetSpentCents: { increment: outcome.priceCents } },
    }),
  ]);
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}
