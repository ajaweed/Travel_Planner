// Checks the restaurants (and, with OUTDOOR_SPEC, the trailheads/parks/beaches)
// the itinerary agent names against Google Places:
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
// COST: one billable Text Search per distinct (restaurant, city), with no
// Details call, de-duplicated across options and capped per generation.

import { reviews, type ProviderResult, type RestaurantPlace } from "@trip-planner/integrations";
import { resolveDraftCities } from "./activityPlaces";
import { type Coords, distanceKm, getPlaceResults } from "./destinationPhoto";
import { placeLabel } from "./placeNames";
import { sameWord, tokens } from "./stopPhotos";

export const MAX_RESTAURANT_CHECKS_PER_GENERATION = 24;
export const MAX_DISTANCE_FROM_CITY_KM = 40;
/** Places calls in flight at once (reviewLookup runs its own batch alongside). */
const CONCURRENCY = 4;
/** Longest we'll wait to retry one rate-limited call. */
const MAX_RETRY_WAIT_MS = 2_000;

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
      /** Where Google puts it (used to take weather where the traveller actually is). */
      location?: { lat: number; lon: number };
    }
  /** Google had nothing matching this name in this city. Not proof it doesn't exist. */
  | { status: "NOT_FOUND" };

/** Why checks are missing, when they are. Shown once under the options. */
export type RestaurantLookupStatus =
  /** `unchecked`: names past the cap or whose lookup failed -- they show no check line. */
  | { status: "OK"; named: number; checked: number; unchecked: number }
  | { status: "NOT_CONFIGURED" }
  | { status: "UNAVAILABLE" }
  | { status: "NO_CANDIDATES" };

/**
 * Key for a restaurant within one option: its whole name, normalised (case,
 * accents, punctuation) but with every word kept -- "Bar 1" and "Bar 2", or
 * "A Cevicheria" and "O Cevicheria", are different places.
 */
export function restaurantKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join(" ");
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

/**
 * Is Google's place the one that was named?
 * - Named with distinctive words: most of them (all, if two or fewer) are in
 *   Google's name, or Google's name is a shorter form whose distinctive words
 *   are all in the requested one ("Páteo" for "Páteo - Bairro Alto Hotel").
 * - Named only with generic words ("The Italian Restaurant", "Rome Kitchen"):
 *   Google's name must be those words too, with nothing distinctive of its
 *   own -- otherwise any "Da Mario Italian Restaurant" would "verify" it.
 */
export function nameMatches(requested: string, googleName: string, city?: string, generic: Set<string> = GENERIC): boolean {
  // "Queimadas, Santana": the part after a comma is often a locality. Try the
  // whole name first, so "Mercado da Ribeira, Time Out Market" still matches
  // on the part after the comma.
  const head = requested.split(",")[0]!.trim();
  return matchesName(requested, googleName, city, generic) || (!!head && head !== requested.trim() && matchesName(head, googleName, city, generic));
}

function matchesName(requested: string, googleName: string, city: string | undefined, generic: Set<string>): boolean {
  const cityWords = city ? tokens(city) : [];
  const notCity = (t: string) => !cityWords.some((c) => sameWord(t, c));
  const req = tokens(requested).filter(notCity);
  const got = tokens(googleName).filter(notCity);
  const has = (words: string[], t: string) => words.some((w) => sameWord(t, w));
  const gotDistinctive = got.filter((t) => !generic.has(t));

  const distinctive = req.filter((t) => !generic.has(t));
  if (distinctive.length === 0) {
    return req.length > 0 && gotDistinctive.length === 0 && req.every((t) => has(got, t));
  }
  const hits = distinctive.filter((t) => has(got, t)).length;
  if (distinctive.length <= 2 ? hits === distinctive.length : hits / distinctive.length >= 0.6) return true;
  return gotDistinctive.length > 0 && gotDistinctive.every((t) => has(req, t));
}

/** Is the place in the city? By distance when both have coordinates, else by its address naming the city. */
export function inCity(
  place: RestaurantPlace,
  city: string,
  cityCoords?: Coords,
  maxDistanceKm: number = MAX_DISTANCE_FROM_CITY_KM,
): boolean {
  if (cityCoords && place.location) return distanceKm(cityCoords, place.location) <= maxDistanceKm;
  // Addresses use local names ("Lisboa"): compare the first five letters.
  const stem = (w: string) => w.slice(0, 5);
  const cityStems = tokens(placeLabel(city)).map(stem);
  const addr = tokens(place.formattedAddress ?? "").map(stem);
  return cityStems.length > 0 && cityStems.every((c) => addr.includes(c));
}

/** Only Google's own Maps URLs: google.com or a subdomain of it, over https. */
export function isGoogleMapsUrl(u: string | undefined): boolean {
  if (!u) return false;
  try {
    const { protocol, hostname } = new URL(u);
    return protocol === "https:" && (hostname === "google.com" || hostname.endsWith(".google.com"));
  } catch {
    return false;
  }
}

function toCheck(place: RestaurantPlace): RestaurantCheck {
  const status =
    place.businessStatus === "OPERATIONAL"
      ? "OPEN"
      : place.businessStatus === "CLOSED_TEMPORARILY" || place.businessStatus === "CLOSED_PERMANENTLY"
        ? place.businessStatus
        : "FOUND";
  return {
    status,
    name: place.name,
    address: place.formattedAddress,
    rating: place.rating,
    userRatingsTotal: place.userRatingsTotal,
    googleMapsUri: isGoogleMapsUrl(place.googleMapsUri) ? place.googleMapsUri : undefined,
    location: place.location,
  };
}

export type DraftLike = {
  days: Array<{
    activities: Array<{
      title: string;
      description?: string | null;
      bookable?: { kind: string; candidateName?: string; searchHint?: string } | null;
      dining?: { restaurantName?: string } | null;
      outdoor?: { placeName?: string; trailName?: string } | null;
    }>;
  }>;
};

type ActivityLike = DraftLike["days"][number]["activities"][number];

/** What to check and how strictly: shared by restaurants and outdoor places. */
export type PlaceCheckSpec = {
  /** The name to check for an activity, if any. */
  pick: (a: ActivityLike) => string | undefined;
  /** Words that say what kind of place it is, not which one. */
  generic: Set<string>;
  maxDistanceKm: number;
  /** Most distinct (name, city) pairs checked per generation. */
  cap: number;
  /**
   * Without the city's coordinates, leave the name unchecked rather than fall
   * back to "does the address name the city": day-trip parks and beaches are
   * outside the city, so that fallback would call real places "not found".
   */
  requireCoords?: boolean;
};

export const RESTAURANT_SPEC: PlaceCheckSpec = {
  pick: (a) => a.dining?.restaurantName,
  generic: GENERIC,
  maxDistanceKm: MAX_DISTANCE_FROM_CITY_KM,
  cap: MAX_RESTAURANT_CHECKS_PER_GENERATION,
};

// Trailheads, parks and beaches: "Sintra-Cascais Natural Park" matches on
// "Sintra"/"Cascais", never on "Natural Park". Local-language words included.
const OUTDOOR_GENERIC = new Set(
  (
    "park parque parco national nacional nazionale natural nature reserve reserva riserva protected regional state " +
    "trail trilho sendero sentiero path route rota ruta walk hike loop circuit trailhead area " +
    "mount mountain mountains monte montes serra sierra peak pico summit hill hills " +
    "beach praia playa spiaggia lake lago lagoa river rio falls waterfall cascata cascada " +
    "viewpoint miradouro mirador belvedere forest floresta florestal forestal bosque woods garden gardens jardim botanical " +
    "valley vale canyon gorge cave caves gruta island ilha isla coast costa cliff cliffs bay baia " +
    "the and"
  ).split(" "),
);

export const OUTDOOR_SPEC: PlaceCheckSpec = {
  pick: (a) => a.outdoor?.placeName,
  generic: OUTDOOR_GENERIC,
  // Day trips: national parks and coastlines are often well outside the city.
  maxDistanceKm: 150,
  cap: 12,
  requireCoords: true,
};

/**
 * The distinct (name, city) pairs a set of options names, in plan order -- the
 * same name in two cities is two places -- and, per option, which pair each
 * of its names refers to (first city wins within an option). Shared by the
 * place and trail checks.
 */
export function collectNamedPairs(
  drafts: DraftLike[],
  destinations: string[],
  pick: (a: ActivityLike) => string | undefined,
): { wanted: Map<string, { name: string; city?: string }>; pairsPerOption: Array<Map<string, string>> } {
  const wanted = new Map<string, { name: string; city?: string }>();
  const pairsPerOption = drafts.map((draft) => {
    const cities = resolveDraftCities(draft.days, destinations);
    const pairs = new Map<string, string>(); // restaurantKey(name) -> pair key
    draft.days.forEach((day, d) =>
      day.activities.forEach((a, i) => {
        const name = pick(a)?.trim();
        const key = name ? restaurantKey(name) : "";
        if (!name || !key || pairs.has(key)) return;
        const city = cities[d]?.[i] ?? destinations[0];
        const pairKey = `${key}|${city ? restaurantKey(city) : ""}`;
        pairs.set(key, pairKey);
        if (!wanted.has(pairKey)) wanted.set(pairKey, { name, city });
      }),
    );
    return pairs;
  });
  return { wanted, pairsPerOption };
}

/** Per option: its names mapped to the results found for their pairs (absent = unchecked). */
export function resultsPerOption<T>(pairsPerOption: Array<Map<string, string>>, results: Map<string, T>): Array<Record<string, T>> {
  return pairsPerOption.map((pairs) =>
    Object.fromEntries([...pairs].flatMap(([key, pairKey]) => (results.has(pairKey) ? [[key, results.get(pairKey)!] as const] : []))),
  );
}

// One limit on Places calls for the whole process: restaurant and outdoor
// checks run at the same time and share the same quota.
type Slots = { free: number; waiters: Array<() => void> };
const gs = globalThis as unknown as { __tripPlannerPlacesSlots?: Slots };
async function withPlacesSlot<T>(fn: () => Promise<T>): Promise<T> {
  const slots = (gs.__tripPlannerPlacesSlots ??= { free: CONCURRENCY, waiters: [] });
  while (slots.free === 0) await new Promise<void>((r) => slots.waiters.push(r));
  slots.free--;
  try {
    return await fn();
  } finally {
    slots.free++;
    slots.waiters.shift()?.();
  }
}

type Find = typeof reviews.findPlace;
type Result = { perOption: Array<Record<string, RestaurantCheck>>; status: RestaurantLookupStatus };

/**
 * Checks every distinct named restaurant across the options. Returns, per
 * option, the checks for the restaurants it names, plus one status.
 * Never throws: this is an optional enrichment and must never cost the
 * traveller their itinerary. Anything unexpected reports UNAVAILABLE.
 */
export async function checkRestaurants(drafts: DraftLike[], destinations: string[], find: Find = reviews.findPlace): Promise<Result> {
  return checkPlaces(drafts, destinations, RESTAURANT_SPEC, find);
}

/** The same checks for the trailheads, parks and beaches outdoor stops name. */
export async function checkOutdoorPlaces(drafts: DraftLike[], destinations: string[], find: Find = reviews.findPlace): Promise<Result> {
  return checkPlaces(drafts, destinations, OUTDOOR_SPEC, find);
}

async function checkPlaces(drafts: DraftLike[], destinations: string[], spec: PlaceCheckSpec, find: Find): Promise<Result> {
  try {
    return await checkPlacesUnsafe(drafts, destinations, spec, find);
  } catch (err) {
    console.error("place checks failed:", err);
    return { perOption: drafts.map(() => ({})), status: { status: "UNAVAILABLE" } };
  }
}

async function checkPlacesUnsafe(drafts: DraftLike[], destinations: string[], spec: PlaceCheckSpec, find: Find): Promise<Result> {
  const { wanted, pairsPerOption } = collectNamedPairs(drafts, destinations, spec.pick);

  const empty = drafts.map(() => ({}));
  if (wanted.size === 0) return { perOption: empty, status: { status: "NO_CANDIDATES" } };

  const todo = [...wanted].slice(0, spec.cap);
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

  const call = async (name: string, city: string | undefined, near: Coords | undefined) => {
    const params = { name, city: city ? placeLabel(city) : undefined, near };
    let res: ProviderResult<RestaurantPlace[]> = await withPlacesSlot(() => find(params));
    // One retry for a rate limit, if Google asks for a short wait.
    if (!res.ok && res.reason === "RATE_LIMITED" && res.retryAfterMs <= MAX_RETRY_WAIT_MS) {
      const wait = res.retryAfterMs;
      await new Promise((r) => setTimeout(r, wait));
      res = await withPlacesSlot(() => find(params));
    }
    return res;
  };

  const checkOne = async ([pairKey, { name, city }]: (typeof todo)[number]): Promise<"NOT_CONFIGURED" | void> => {
    const near = city ? coords.get(city) : undefined;
    if (spec.requireCoords && city && !near) return; // can't judge location: unchecked
    const res = await call(name, city, near);
    if (res.ok) {
      const match = res.data.find(
        (p) => nameMatches(name, p.name, city, spec.generic) && (!city || inCity(p, city, near, spec.maxDistanceKm)),
      );
      checks.set(pairKey, match ? toCheck(match) : { status: "NOT_FOUND" });
      return;
    }
    if (res.reason === "NO_AVAILABILITY") {
      checks.set(pairKey, { status: "NOT_FOUND" });
      return;
    }
    failures++; // incl. a key rejected after the probe: unchecked, and counted
    if (res.reason === "NOT_CONFIGURED") return "NOT_CONFIGURED";
  };

  // Probe first: with no key (or a rejected one) every call would fail the same way.
  if ((await checkOne(todo[0]!)) === "NOT_CONFIGURED") return { perOption: empty, status: { status: "NOT_CONFIGURED" } };

  // The rest, a few at a time, so a modest Places quota isn't burst into 429s.
  const queue = todo.slice(1);
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await checkOne(next);
    }),
  );

  const status: RestaurantLookupStatus =
    checks.size === 0 && failures > 0
      ? { status: "UNAVAILABLE" }
      : { status: "OK", named: wanted.size, checked: checks.size, unchecked: wanted.size - checks.size };
  return { perOption: resultsPerOption(pairsPerOption, checks), status };
}
