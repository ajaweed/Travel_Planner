import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@trip-planner/db";
import { getBudgetStatus, getUnreadNotifications } from "@trip-planner/core";

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

  const budget = await getBudgetStatus(trip.id);
  const unread = await getUnreadNotifications(trip.id);

  return NextResponse.json({ trip, budget, unreadCount: unread.length });
}
