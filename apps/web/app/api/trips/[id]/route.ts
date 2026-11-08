import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@trip-planner/db";
import {
  buildResearchLinks,
  destinationFor,
  getAiBookingReadiness,
  getBudgetStatus,
  getUnreadNotifications,
  linksForStoredBooking,
  reapStalledBookings,
} from "@trip-planner/core";

// In AI mode, anything the agent couldn't book (failed, or waiting on the
// user, e.g. over budget) gets links as a do-it-yourself fallback. Not while
// SEARCHING: offering links mid-booking invites the user and the agent to
// book the same thing twice.
const NO_LINKS = new Set(["BOOKED", "CANCELLED", "SEARCHING"]);

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  // Cheap no-op unless an AI booking pass died part-way; see the function.
  await reapStalledBookings(params.id);
  const trip = await prisma.trip.findUnique({
    where: { id: params.id },
    include: {
      itinerary: {
        orderBy: { dayIndex: "asc" },
        include: { activities: { orderBy: { order: "asc" }, include: { booking: true } } },
      },
      notifications: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  // Booking links are derived at read time from each booking's stored search
  // params (never stored URLs), so improving the link builder improves every
  // existing trip without a migration.
  const destinations: string[] = safeDestinations(trip.briefJson);
  const itinerary = trip.itinerary.map((day) => ({
    ...day,
    activities: day.activities.map((activity) => ({
      ...activity,
      // "See what people say" (Google / Reddit) -- deterministic URLs, never
      // model-written. Bookable rows use the named place + city they stored.
      research: researchFor(activity, destinations),
      booking: activity.booking && {
        ...activity.booking,
        links:
          activity.booking.status === "LINK_OUT" ||
          // Fallback links only on AI-mode trips: legacy (pre-link) rows only
          // stored a hint, so their links would lack dates and destination.
          (trip.bookingMode === "AI" && !NO_LINKS.has(activity.booking.status))
            ? linksForStoredBooking(activity.booking.kind, activity.booking.searchParamsJson)
            : [],
      },
    })),
  }));

  const [budget, unread] = await Promise.all([
    getBudgetStatus(trip.id),
    getUnreadNotifications(trip.id),
  ]);

  return NextResponse.json({
    trip: { ...trip, itinerary },
    aiBooking: getAiBookingReadiness(),
    budget,
    unreadCount: unread.length,
  });
}

function safeDestinations(briefJson: string): string[] {
  try {
    const d = JSON.parse(briefJson)?.destinations;
    return Array.isArray(d) ? d.filter((x: unknown): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function researchFor(
  activity: { title: string; description: string | null; booking: { kind: string; searchParamsJson: string } | null },
  destinations: string[],
) {
  let stored: { candidateName?: unknown; destination?: unknown } = {};
  if (activity.booking) {
    try {
      const parsed = JSON.parse(activity.booking.searchParamsJson);
      if (parsed && typeof parsed === "object") stored = parsed;
    } catch {
      /* fall back to title + trip destination */
    }
  }
  const candidateName = typeof stored.candidateName === "string" ? stored.candidateName : undefined;
  const destination =
    (typeof stored.destination === "string" ? stored.destination : undefined) ??
    destinationFor(destinations, candidateName, activity.title, activity.description ?? undefined);
  return buildResearchLinks({
    title: activity.title,
    candidateName,
    destination,
    kind: activity.booking?.kind,
  });
}
