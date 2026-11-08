import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@trip-planner/db";
import {
  buildBookingLinks,
  buildResearchLinks,
  destinationsFromBrief,
  getAiBookingReadiness,
  getBudgetStatus,
  getUnreadNotifications,
  reapStalledBookings,
  resolveActivityPlaces,
} from "@trip-planner/core";
import type { BookingKind } from "@trip-planner/db";

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

  // Booking and research links are derived at read time from each booking's
  // stored search params (never stored URLs), so improving a link builder
  // improves every existing trip without a migration.
  const destinations = destinationsFromBrief(trip.briefJson);
  // Each activity's city (multi-city aware) and stored search params.
  const places = resolveActivityPlaces(trip.itinerary, destinations);

  const itinerary = trip.itinerary.map((day) => ({
    ...day,
    activities: day.activities.map((activity) => {
      const { params, city } = places.get(activity.id) ?? { params: {} };
      const candidateName = typeof params.candidateName === "string" ? params.candidateName : undefined;
      return {
        ...activity,
        // "See what people say" (Google / Reddit) -- deterministic URLs, never model-written.
        research: buildResearchLinks({
          title: activity.title,
          candidateName,
          destination: city,
          kind: activity.booking?.kind,
        }),
        booking: activity.booking && {
          ...activity.booking,
          links:
            activity.booking.status === "LINK_OUT" ||
            // Fallback links only on AI-mode trips: legacy (pre-link) rows only
            // stored a hint, so their links would lack dates and destination.
            (trip.bookingMode === "AI" && !NO_LINKS.has(activity.booking.status))
              ? buildBookingLinks({
                  ...params,
                  kind: activity.booking.kind as BookingKind,
                  searchHint: typeof params.searchHint === "string" ? params.searchHint : "",
                })
              : [],
        },
      };
    }),
  }));

  const [budget, unread] = await Promise.all([
    getBudgetStatus(trip.id),
    getUnreadNotifications(trip.id),
  ]);

  return NextResponse.json({
    trip: { ...trip, itinerary },
    // For the header photos; [] until the brief names a place.
    destinations,
    aiBooking: getAiBookingReadiness(),
    budget,
    unreadCount: unread.length,
  });
}
