// Checks the named trails outdoor stops propose against OpenStreetMap (via
// Waymarked Trails): is there a mapped route by that name near the trip, and
// how long is it? Runs once while options are generated, like the place checks.
//
// A result counts only if its name matches (beyond generic words like
// "Trail"/"Trilho") and the route's centre is within reach of the stop's city.
// Results are stored per option as `trailChecks`, keyed by trail name -- never
// on the model's output.

import { trails as trailsApi } from "@trip-planner/integrations";
import { resolveDraftCities } from "./activityPlaces";
import { type Coords, distanceKm, getPlaceResults } from "./destinationPhoto";
import { OUTDOOR_SPEC, nameMatches, restaurantKey } from "./restaurantChecks";
import { tokens } from "./stopPhotos";
import { ttlCache } from "./ttlCache";

export const MAX_TRAIL_CHECKS_PER_GENERATION = 8;
const DETAILS_PER_TRAIL = 2;

export type TrailCheck =
  | { status: "FOUND"; name: string; lengthKm?: number; url: string }
  /** No mapped route by that name near the trip. Plenty of real walks aren't waymarked routes. */
  | { status: "NOT_FOUND" };

type Api = Pick<typeof trailsApi, "searchTrails" | "trailDetails">;

type DraftLike = {
  days: Array<{
    activities: Array<{
      title: string;
      description?: string | null;
      bookable?: { kind: string; candidateName?: string; searchHint?: string } | null;
      dining?: { restaurantName?: string } | null;
      outdoor?: { trailName?: string } | null;
    }>;
  }>;
};

// Sections that aren't the route itself.
const SIDE_ROUTE = /\b(alternativ\w*|variant\w*|link|ligacao|spur|connector|desvio)\b/;

// Per (trail, city): a week for answers, a day for misses. Nothing cached on provider errors.
const cache = ttlCache<TrailCheck>("trails", 500);

/** Test-only. */
export function resetTrailCache(): void {
  cache.clear();
}

async function checkOne(name: string, coords: Coords, city: string, api: Api): Promise<TrailCheck | undefined> {
  const found = await api.searchTrails(name);
  if (!found.ok) return found.reason === "NO_AVAILABILITY" ? { status: "NOT_FOUND" } : undefined;

  const candidates = found.data
    .filter((t) => nameMatches(name, t.name, city, OUTDOOR_SPEC.generic) || (t.ref && nameMatches(name, t.ref, city, OUTDOOR_SPEC.generic)))
    // Closest name first: fewest words the request doesn't have; main routes before side routes.
    .map((t) => {
      const want = new Set(tokens(name));
      const extra = tokens(t.name).filter((w) => !want.has(w) && !OUTDOOR_SPEC.generic.has(w)).length;
      return { t, score: extra + (SIDE_ROUTE.test(tokens(t.name).join(" ")) ? 10 : 0) };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, DETAILS_PER_TRAIL);

  let providerTrouble = false;
  for (const { t } of candidates) {
    const d = await api.trailDetails(t.id);
    if (!d.ok) {
      if (d.reason !== "NO_AVAILABILITY") providerTrouble = true;
      continue;
    }
    if (!d.data.centre || distanceKm(coords, d.data.centre) > OUTDOOR_SPEC.maxDistanceKm) continue;
    return {
      status: "FOUND",
      name: d.data.name,
      lengthKm: d.data.lengthM ? Math.round(d.data.lengthM / 100) / 10 : undefined,
      url: d.data.url,
    };
  }
  return providerTrouble ? undefined : { status: "NOT_FOUND" };
}

/**
 * Checks every distinct named trail across the options (capped, one at a
 * time to be gentle on a free service, cached). Returns per-option checks.
 * Never throws; unchecked trails are simply absent.
 */
export async function checkTrails(
  drafts: DraftLike[],
  destinations: string[],
  api: Api = trailsApi,
  now: number = Date.now(),
): Promise<Array<Record<string, TrailCheck>>> {
  try {
    const wanted = new Map<string, { name: string; city: string }>();
    const pairsPerOption = drafts.map((draft) => {
      const cities = resolveDraftCities(draft.days, destinations);
      const pairs = new Map<string, string>();
      draft.days.forEach((day, d) =>
        day.activities.forEach((a, i) => {
          const name = a.outdoor?.trailName?.trim();
          const city = cities[d]?.[i] ?? destinations[0];
          const key = name ? restaurantKey(name) : "";
          if (!name || !key || !city || pairs.has(key)) return;
          const pairKey = `${key}|${restaurantKey(city)}`;
          pairs.set(key, pairKey);
          if (!wanted.has(pairKey)) wanted.set(pairKey, { name, city });
        }),
      );
      return pairs;
    });
    if (wanted.size === 0) return drafts.map(() => ({}));

    const todo = [...wanted].slice(0, MAX_TRAIL_CHECKS_PER_GENERATION);
    const places = await getPlaceResults([...new Set(todo.map(([, w]) => w.city))]);
    const results = new Map<string, TrailCheck>();
    for (const [pairKey, { name, city }] of todo) {
      const hit = cache.get(pairKey, now);
      if (hit) {
        results.set(pairKey, hit);
        continue;
      }
      const coords = places.get(city)?.coords;
      if (!coords) continue; // can't check location: leave unchecked
      const check = await checkOne(name, coords, city, api);
      if (!check) continue;
      cache.set(pairKey, check, check.status === "FOUND" ? 7 * 86_400_000 : 86_400_000, now);
      results.set(pairKey, check);
    }
    return pairsPerOption.map((pairs) =>
      Object.fromEntries([...pairs].flatMap(([key, pairKey]) => (results.has(pairKey) ? [[key, results.get(pairKey)!] as const] : []))),
    );
  } catch (err) {
    console.error("checkTrails failed:", err);
    return drafts.map(() => ({}));
  }
}
