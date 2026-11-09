import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@trip-planner/db";
import {
  centroid,
  cityCoords,
  destinationsFromBrief,
  planExtras,
  resolveActivityPlaces,
  weatherForDates,
  weatherWarnings,
  type DayWeather,
} from "@trip-planner/core";

type Point = { lat: number; lon: number };

// GET /api/trips/:id/weather ->
//   { days: { [dayId]: DayWeather & { city, where } }, warnings: { [activityId]: string[] } }
// Each itinerary day's weather where the traveller will actually be: the
// centre of that day's Google-verified stops, else the hotel, else the
// destination (a region's centre can be a mountain, so the chip shows the
// elevation then). A forecast within ~16 days, else typical for the date --
// always labelled. Warnings attach to outdoor stops. Separate from the trip
// route, which is polled every 4s; these come from Open-Meteo (cached).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const trip = await prisma.trip.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      briefJson: true,
      itinerary: {
        orderBy: { dayIndex: "asc" },
        select: {
          id: true,
          dayIndex: true,
          date: true,
          activities: {
            orderBy: { order: "asc" },
            select: { id: true, order: true, title: true, description: true, booking: { select: { kind: true, searchParamsJson: true } } },
          },
        },
      },
    },
  });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  const destinations = destinationsFromBrief(trip.briefJson);
  const places = resolveActivityPlaces(trip.itinerary, destinations);
  const selected = await prisma.itineraryOption.findFirst({
    where: { tripId: trip.id, status: "SELECTED" },
    select: { draftJson: true },
  });
  const extras = planExtras(trip.itinerary, selected?.draftJson, {}, (id) => places.get(id)?.city, destinations);
  const hotel = destinations.length === 1 ? hotelLocation(selected?.draftJson) : undefined;

  // Each day's city (where most of its non-flight stops are) and weather point.
  const dayCity = new Map<string, string>();
  const dayPoint = new Map<string, { point: Point; where: "stops" | "hotel" | "destination" }>();
  const cities = new Set<string>();
  for (const day of trip.itinerary) {
    const counts = new Map<string, number>();
    const verified: Array<Point | undefined> = [];
    for (const a of day.activities) {
      if (a.booking?.kind === "FLIGHT") continue;
      const c = places.get(a.id)?.city;
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
      const meal = extras.dining.get(a.id)?.check;
      const outdoor = extras.outdoor.get(a.id)?.placeCheck;
      for (const chk of [meal, outdoor]) if (chk && chk.status !== "NOT_FOUND") verified.push(chk.location);
    }
    const city = [...counts].sort((x, y) => y[1] - x[1])[0]?.[0] ?? destinations[0];
    if (city) {
      dayCity.set(day.id, city);
      cities.add(city);
    }
    const stops = centroid(verified);
    if (stops) dayPoint.set(day.id, { point: stops, where: "stops" });
    else if (hotel) dayPoint.set(day.id, { point: hotel, where: "hotel" });
  }
  const cityPoints = await cityCoords([...cities]);
  for (const day of trip.itinerary) {
    const city = dayCity.get(day.id);
    const c = city ? cityPoints.get(city) : undefined;
    if (!dayPoint.has(day.id) && c) dayPoint.set(day.id, { point: c, where: "destination" });
  }

  // One weather lookup per (rounded) point, for its days' dates.
  const key = (p: Point) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
  const groups = new Map<string, { point: Point; dates: string[] }>();
  for (const day of trip.itinerary) {
    const p = dayPoint.get(day.id);
    if (!p || !day.date) continue;
    const g = groups.get(key(p.point)) ?? { point: p.point, dates: [] };
    g.dates.push(day.date.toISOString().slice(0, 10));
    groups.set(key(p.point), g);
  }
  const results = new Map<string, Map<string, DayWeather>>();
  await Promise.all(
    [...groups].map(async ([k, g]) => results.set(k, await weatherForDates(g.point, g.dates))),
  );

  const days: Record<string, DayWeather & { city?: string; where: string }> = {};
  for (const day of trip.itinerary) {
    const p = dayPoint.get(day.id);
    const w = p && day.date ? results.get(key(p.point))?.get(day.date.toISOString().slice(0, 10)) : undefined;
    if (w && p) days[day.id] = { ...w, city: dayCity.get(day.id), where: p.where };
  }

  const warnings: Record<string, string[]> = {};
  for (const day of trip.itinerary) {
    for (const a of day.activities) {
      const o = extras.outdoor.get(a.id);
      const list = o ? weatherWarnings(days[day.id], o.type) : [];
      if (list.length) warnings[a.id] = list;
    }
  }

  return NextResponse.json({ days, warnings }, { headers: { "Cache-Control": "private, max-age=1800" } });
}

/** The chosen plan's hotel location, if the ratings lookup found it on Google. */
function hotelLocation(draftJson: string | null | undefined): Point | undefined {
  if (!draftJson) return undefined;
  try {
    const draft = JSON.parse(draftJson) as {
      days?: Array<{ activities?: Array<{ bookable?: { kind?: string; review?: { location?: Point } } }> }>;
    };
    for (const day of draft.days ?? []) {
      for (const a of day.activities ?? []) {
        const loc = a.bookable?.kind === "HOTEL" ? a.bookable.review?.location : undefined;
        if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon)) return loc;
      }
    }
  } catch {
    // no hotel location
  }
  return undefined;
}
