// Checks the restaurants the itinerary agent names against Google Places:
// does the place exist where the plan says, is it open, and what do people
// rate it? Runs once while options are generated, like reviewLookup.ts.
//
// The hard part is not calling Google but trusting the answer: Text Search
// always returns its nearest guess, so for a name the model made up it
// returns some *other* restaurant. A result counts only if its name matches
// the requested one (not just "Taberna" or "Restaurant") and it's in the
// stop's city (distance from the city centre, else its address).
//
// Results are stored per option as `restaurantChecks` keyed by name, NOT on
// the model's dining blocks: the model can never write its own "verified".
//
// COST: one billable Text Search per distinct restaurant name (no Details
// call), de-duplicated across options and capped per generation.

import { reviews, type RestaurantPlace } from "@trip-planner/integrations";
import { resolveDraftCities } from "./activityPlaces";
import { type Coords, distanceKm, getPlaceResults } from "./destinationPhoto";
import { placeLabel } from "./placeNames";
import { tokens } from "./stopPhotos";

export const MAX_RESTAURANT_CHECKS_PER_GENERATION = 24;
export const MAX_DISTANCE_FROM_CITY_KM = 40;

export type RestaurantCheck =
  | {
      /** OPEN = Google says operational; FOUND = exists, status unknown. */
      status: "OPEN" | "FOUND" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY";
      /** Google's name for it. */
      name: string;
      address?: string;
      rating?: number;
      userRatingsTotal?: number;
      googleMapsUri?: string;
    }
  /** Google had nothing matching this name in this city. Not proof it doesn't exist. */
  | { status: "NOT_FOUND" };

/** Why checks are missing, when they are (shown once, like reviewLookup). */
export type RestaurantLookupStatus =
  | { status: "OK"; named: number; checked: number }
  | { status: "NOT_CONFIGURED" }
  | { status: "UNAVAILABLE" }
  | { status: "NO_CANDIDATES" };

/** Key for a restaurant within one option (its name, normalised). */
export function restaurantKey(name: string): string {
  return tokens(name).join(" ");
}

// Words that say what kind of place it is, not which one: "Taberna do
// Mercado" must match on "Mercado", not on "Taberna".
const GENERIC = new Set(
  (
    "restaurant restaurante ristorante cafe caffe coffee bar bistro brasserie tasca taberna tavern trattoria " +
    "osteria pizzeria cantina kitchen grill house casa maison shop bakery pastelaria pasteleria market mercado " +
    "food foods eatery dining diner lounge pub inn hotel the and " +
    // Cuisines say what's served, not which place: "Zaafran Indian Restaurant" is Google's "Zaafran".
    "indian italian japanese chinese thai vietnamese korean mexican lebanese turkish greek french spanish " +
    "portuguese moroccan persian middle eastern asian fusion vegan vegetarian seafood steakhouse sushi ramen"
  ).split(" "),
);

function sameWord(a: string, b: string): boolean {
  return a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));
}

/**
 * Is Google's place the one that was named? Either most of the requested
 * name's distinctive words (all, if it has two or fewer) are in Google's name,
 * or Google's name is a shorter form whose distinctive words are all in the
 * requested one ("Páteo" for "Páteo - Bairro Alto Hotel"). Generic words
 * ("Taberna", "Restaurant", "Indian") never match on their own; a name made
 * only of generic words ("Café Central") needs all its words.
 */
export function nameMatches(requested: string, googleName: string, city?: string): boolean {
  const cityWords = city ? tokens(city) : [];
  const notCity = (t: string) => !cityWords.some((c) => sameWord(t, c));
  const req = tokens(requested).filter(notCity);
  const got = tokens(googleName).filter(notCity);
  const has = (words: string[], t: string) => words.some((w) => sameWord(t, w));

  const distinctive = req.filter((t) => !GENERIC.has(t));
  const needed = distinctive.length ? distinctive : req;
  if (needed.length === 0) return false;
  const hits = needed.filter((t) => has(got, t)).length;
  if (needed.length <= 2 ? hits === needed.length : hits / needed.length >= 0.6) return true;

  const gotDistinctive = got.filter((t) => !GENERIC.has(t));
  return gotDistinctive.length > 0 && gotDistinctive.every((t) => has(req, t));
}

/** Is the place in the city? By distance when both have coordinates, else by its address naming the city. */
export function inCity(place: RestaurantPlace, city: string, cityCoords?: Coords): boolean {
  if (cityCoords && place.location) return distanceKm(cityCoords, place.location) <= MAX_DISTANCE_FROM_CITY_KM;
  // Addresses use local names ("Lisboa"): compare the first five letters.
  const stem = (w: string) => w.slice(0, 5);
  const cityStems = tokens(placeLabel(city)).map(stem);
  const addr = tokens(place.formattedAddress ?? "").map(stem);
  return cityStems.length > 0 && cityStems.every((c) => addr.includes(c));
}

function toCheck(place: RestaurantPlace): RestaurantCheck {
  const status =
    place.businessStatus === "OPERATIONAL"
      ? "OPEN"
      : place.businessStatus === "CLOSED_TEMPORARILY" || place.businessStatus === "CLOSED_PERMANENTLY"
        ? place.businessStatus
        : "FOUND";
  let googleMapsUri: string | undefined;
  try {
    // Only Google's own Maps URLs; never a link we didn't expect.
    if (place.googleMapsUri && new URL(place.googleMapsUri).hostname.endsWith("google.com")) googleMapsUri = place.googleMapsUri;
  } catch {
    googleMapsUri = undefined;
  }
  return {
    status,
    name: place.name,
    address: place.formattedAddress,
    rating: place.rating,
    userRatingsTotal: place.userRatingsTotal,
    googleMapsUri,
  };
}

type DraftLike = {
  days: Array<{
    activities: Array<{
      title: string;
      description?: string | null;
      bookable?: { kind: string; candidateName?: string; searchHint?: string } | null;
      dining?: { restaurantName?: string } | null;
    }>;
  }>;
};

type Find = typeof reviews.findRestaurant;

/**
 * Checks every distinct named restaurant across the options. Returns, per
 * option, the checks for the restaurants it names, plus one status.
 * Never throws: a provider failure leaves names unchecked (absent), which the
 * UI shows as nothing rather than as "not found".
 */
export async function checkRestaurants(
  drafts: DraftLike[],
  destinations: string[],
  find: Find = reviews.findRestaurant,
): Promise<{ perOption: Array<Record<string, RestaurantCheck>>; status: RestaurantLookupStatus }> {
  // Distinct (name, city) pairs, in plan order.
  const wanted = new Map<string, { name: string; city?: string }>();
  const namesPerOption = drafts.map((draft) => {
    const cities = resolveDraftCities(draft.days, destinations);
    const keys: string[] = [];
    draft.days.forEach((day, d) =>
      day.activities.forEach((a, i) => {
        const name = a.dining?.restaurantName?.trim();
        if (!name) return;
        const key = restaurantKey(name);
        if (!key) return;
        keys.push(key);
        if (!wanted.has(key)) wanted.set(key, { name, city: cities[d]?.[i] ?? destinations[0] });
      }),
    );
    return keys;
  });

  const empty = drafts.map(() => ({}));
  if (wanted.size === 0) return { perOption: empty, status: { status: "NO_CANDIDATES" } };

  const todo = [...wanted].slice(0, MAX_RESTAURANT_CHECKS_PER_GENERATION);
  let coords = new Map<string, Coords | undefined>();
  try {
    const cities = [...new Set(todo.flatMap(([, w]) => (w.city ? [w.city] : [])))];
    const places = await getPlaceResults(cities);
    coords = new Map(cities.map((c) => [c, places.get(c)?.coords]));
  } catch {
    // No coordinates: fall back to address matching.
  }

  const checks = new Map<string, RestaurantCheck>();
  let failures = 0;
  const checkOne = async ([key, { name, city }]: (typeof todo)[number]): Promise<"NOT_CONFIGURED" | void> => {
    const near = city ? coords.get(city) : undefined;
    const res = await find({ name, city: city ? placeLabel(city) : undefined, near });
    if (res.ok) {
      const match = res.data.find((p) => nameMatches(name, p.name, city) && (!city || inCity(p, city, near)));
      checks.set(key, match ? toCheck(match) : { status: "NOT_FOUND" });
    } else if (res.reason === "NO_AVAILABILITY") {
      checks.set(key, { status: "NOT_FOUND" });
    } else if (res.reason === "NOT_CONFIGURED") {
      return "NOT_CONFIGURED";
    } else {
      failures++;
    }
  };

  // Probe first: with no key (or a rejected one) every call would fail the same way.
  if ((await checkOne(todo[0]!)) === "NOT_CONFIGURED") return { perOption: empty, status: { status: "NOT_CONFIGURED" } };
  await Promise.all(todo.slice(1).map(checkOne));

  const status: RestaurantLookupStatus =
    failures === todo.length ? { status: "UNAVAILABLE" } : { status: "OK", named: wanted.size, checked: checks.size };
  const perOption = namesPerOption.map((keys) =>
    Object.fromEntries(keys.flatMap((k) => (checks.has(k) ? [[k, checks.get(k)!] as const] : []))),
  );
  return { perOption, status };
}
