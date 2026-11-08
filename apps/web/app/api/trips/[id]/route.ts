import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@trip-planner/db";
import {
  buildBookingLinks,
  buildResearchLinks,
  destinationFor,
  destinationsFromBrief,
  getAiBookingReadiness,
  getBudgetStatus,
  getUnreadNotifications,
  parseStoredSearchParams,
  reapStalledBookings,
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
  // Multi-city trips: the agent doesn't tag days with a city, so an activity
  // that doesn't name one ("Casual dinner at a local tasca") inherits its day's
  // city -- taken from that day's bookings -- carried forward from earlier days.
  let carriedCity: string | undefined = destinations.length === 1 ? destinations[0] : undefined;

  const itinerary = trip.itinerary.map((day) => {
    const stored = new Map(
      day.activities.flatMap((a) =>
        a.booking ? [[a.id, parseStoredSearchParams(a.booking.searchParamsJson)] as const] : [],
      ),
    );
    const dayCity =
      day.activities
        .map((a) => (a.booking?.kind !== "FLIGHT" ? stored.get(a.id)?.destination : undefined))
        .find((d): d is string => typeof d === "string") ?? carriedCity;
    carriedCity = dayCity;

    return {
      ...day,
      activities: day.activities.map((activity) => {
        const params = stored.get(activity.id) ?? {};
        const candidateName = typeof params.candidateName === "string" ? params.candidateName : undefined;
        return {
          ...activity,
          // "See what people say" (Google / Reddit) -- deterministic URLs, never model-written.
          research: buildResearchLinks({
            title: activity.title,
            candidateName,
            destination:
              (typeof params.destination === "string" ? params.destination : undefined) ??
              destinationFor(destinations, candidateName, activity.title, activity.description ?? undefined) ??
              dayCity,
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
    };
  });

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
