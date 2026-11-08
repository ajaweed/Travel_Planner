import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@trip-planner/db";
import { destinationsFromBrief, getStopPhotos, resolveActivityPlaces } from "@trip-planner/core";

// GET /api/trips/:id/photos -> { stops: { [activityId]: DestinationPhoto } }
// Photos of the named places in the chosen itinerary (see core/stopPhotos).
// Separate from the trip route because that one is polled every 4s, and
// these lookups go out to Wikimedia (cached server-side for a day).
// Stops without a confident, freely licensed match are simply absent.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const trip = await prisma.trip.findUnique({
    where: { id: params.id },
    select: {
      briefJson: true,
      itinerary: {
        orderBy: { dayIndex: "asc" },
        select: {
          activities: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              title: true,
              description: true,
              booking: { select: { kind: true, searchParamsJson: true } },
            },
          },
        },
      },
    },
  });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  const places = resolveActivityPlaces(trip.itinerary, destinationsFromBrief(trip.briefJson));
  const stops = trip.itinerary.flatMap((day) =>
    day.activities.map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      city: places.get(a.id)?.city,
      kind: a.booking?.kind,
    })),
  );
  const photos = await getStopPhotos(stops);
  // Short browser cache: a stop that missed because Wikimedia was busy should
  // get another chance on the next visit.
  return NextResponse.json(
    { stops: Object.fromEntries(photos) },
    { headers: { "Cache-Control": "private, max-age=300" } },
  );
}
