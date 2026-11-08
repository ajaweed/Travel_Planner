// Which city is each itinerary activity in? Shared by the trip route (research
// links) and the stop-photos route so both always agree.

import { destinationFor, parseStoredSearchParams, type LinkSearchParams } from "./bookingLinks";

type DayLike = {
  activities: Array<{
    id: string;
    title: string;
    description?: string | null;
    booking?: { kind: string; searchParamsJson: string } | null;
  }>;
};

export type ActivityPlace = {
  /** The booking's stored search params ({} if none). */
  params: Partial<LinkSearchParams>;
  /** The activity's city, if it can be told. */
  city?: string;
};

/**
 * Multi-city trips: the agent doesn't tag days with a city, so an activity
 * that doesn't name one ("Casual dinner at a local tasca") inherits its day's
 * city -- taken from that day's non-flight bookings -- carried forward from
 * earlier days. An activity's own booking destination, or a destination its
 * text names, wins over the day's city.
 */
export function resolveActivityPlaces(days: DayLike[], destinations: string[]): Map<string, ActivityPlace> {
  const out = new Map<string, ActivityPlace>();
  let carriedCity: string | undefined = destinations.length === 1 ? destinations[0] : undefined;

  for (const day of days) {
    const stored = new Map(
      day.activities.flatMap((a) => (a.booking ? [[a.id, parseStoredSearchParams(a.booking.searchParamsJson)] as const] : [])),
    );
    const dayCity =
      day.activities
        .map((a) => (a.booking?.kind !== "FLIGHT" ? stored.get(a.id)?.destination : undefined))
        .find((d): d is string => typeof d === "string") ?? carriedCity;
    carriedCity = dayCity;

    for (const a of day.activities) {
      const params = stored.get(a.id) ?? {};
      const candidateName = typeof params.candidateName === "string" ? params.candidateName : undefined;
      const city =
        (typeof params.destination === "string" ? params.destination : undefined) ??
        destinationFor(destinations, candidateName, a.title, a.description ?? undefined) ??
        dayCity;
      out.set(a.id, { params, city });
    }
  }
  return out;
}
