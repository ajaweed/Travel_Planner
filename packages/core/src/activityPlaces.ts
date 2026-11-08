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

type DraftDayLike = {
  activities: Array<{
    title: string;
    description?: string | null;
    bookable?: { kind: string; candidateName?: string; searchHint?: string } | null;
    dining?: { restaurantName?: string } | null;
  }>;
};

/**
 * The same city logic for a not-yet-chosen option's draft (no saved rows or
 * stored search params yet): a day's city comes from its non-flight bookables
 * and carries forward; an activity naming a destination wins. Returns cities
 * as [day][activity].
 */
export function resolveDraftCities(days: DraftDayLike[], destinations: string[]): Array<Array<string | undefined>> {
  let carried: string | undefined = destinations.length === 1 ? destinations[0] : undefined;
  return days.map((day) => {
    const dayCity =
      day.activities
        .filter((a) => a.bookable && a.bookable.kind !== "FLIGHT")
        .map((a) => destinationFor(destinations, a.bookable!.candidateName, a.title, a.bookable!.searchHint))
        .find((c): c is string => !!c) ?? carried;
    carried = dayCity;
    return day.activities.map(
      (a) => destinationFor(destinations, a.dining?.restaurantName, a.title, a.description ?? undefined) ?? dayCity,
    );
  });
}

/** A local dish's city: the trip's only one, or the destination its text names (else unknown). */
export function foodCity(food: { name: string; description?: string; whereToTry?: string }, destinations: string[]): string | undefined {
  return destinations.length <= 1
    ? destinations[0]
    : destinationFor(destinations, food.name, food.description, food.whereToTry);
}
