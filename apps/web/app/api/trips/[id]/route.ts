import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@trip-planner/db";
import { getBudgetStatus, getUnreadNotifications, linksForStoredBooking } from "@trip-planner/core";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
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
  const itinerary = trip.itinerary.map((day) => ({
    ...day,
    activities: day.activities.map((activity) => ({
      ...activity,
      booking: activity.booking && {
        ...activity.booking,
        links: linksForStoredBooking(activity.booking.kind, activity.booking.searchParamsJson),
      },
    })),
  }));

  const budget = await getBudgetStatus(trip.id);
  const unread = await getUnreadNotifications(trip.id);

  return NextResponse.json({ trip: { ...trip, itinerary }, budget, unreadCount: unread.length });
}
