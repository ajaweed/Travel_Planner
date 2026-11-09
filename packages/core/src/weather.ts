// Weather for a trip's days: a real forecast when the date is within Open-
// Meteo's ~16-day window, otherwise what's typical for that date (the same
// dates over the last few years, averaged). Plus warnings for outdoor stops
// and a short climate summary the itinerary agent plans around.
//
// Always labelled as forecast vs typical in the UI: a "typical" 24°C is not a
// promise. Never throws; missing weather is simply absent.

import { weather as weatherApi } from "@trip-planner/integrations";

type DailyWeather = weatherApi.DailyWeather;
import type { Coords } from "./destinationPhoto";
import { getPlaceResults } from "./destinationPhoto";
import { placeLabel } from "./placeNames";
import { ttlCache } from "./ttlCache";

export const FORECAST_DAYS = 15;
export const TYPICAL_YEARS = 3;
/** Above this, a weather point is labelled with its elevation. */
export const HIGH_POINT_M = 500;

/** Average of points, e.g. the places a day visits; undefined for none. */
export function centroid(points: Array<Coords | undefined>): Coords | undefined {
  const ps = points.filter((p): p is Coords => !!p);
  if (ps.length === 0) return undefined;
  return { lat: ps.reduce((a, p) => a + p.lat, 0) / ps.length, lon: ps.reduce((a, p) => a + p.lon, 0) / ps.length };
}

export type DayWeather = DailyWeather & {
  kind: "forecast" | "typical";
  /** Typical only: how many past years the average covers. */
  years?: number;
};

type Api = Pick<typeof weatherApi, "dailyForecast" | "dailyHistory">;

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The same calendar date in another year (29 Feb -> 28 Feb). */
function inYear(iso: string, year: number): string {
  const [, m, d] = iso.split("-");
  const day = m === "02" && d === "29" ? "28" : d;
  return `${year}-${m}-${day}`;
}

const cache = ttlCache<DailyWeather[]>("weather", 300);

/** Test-only. */
export function resetWeatherCache(): void {
  cache.clear();
}

async function cached(
  kind: "f" | "h",
  q: { lat: number; lon: number; start: string; end: string },
  api: Api,
  ttlMs: number,
): Promise<DailyWeather[] | undefined> {
  const key = `${kind}|${q.lat.toFixed(2)},${q.lon.toFixed(2)}|${q.start}|${q.end}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const res = kind === "f" ? await api.dailyForecast(q) : await api.dailyHistory(q);
  if (!res.ok) {
    // "No data for those dates" is an answer worth remembering; errors aren't.
    if (res.reason === "NO_AVAILABILITY") cache.set(key, [], ttlMs);
    return undefined;
  }
  cache.set(key, res.data, ttlMs);
  return res.data;
}

const avg = (xs: Array<number | undefined>) => {
  const v = xs.filter((x): x is number => x !== undefined);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : undefined;
};

/**
 * Weather for each date at one place. Dates within the forecast window get
 * the forecast; the rest get the average of the same dates over the last
 * TYPICAL_YEARS years, with rainChancePct = share of those years with >= 1 mm.
 */
export async function weatherForDates(
  coords: Coords,
  dates: string[],
  today: string = new Date().toISOString().slice(0, 10),
  api: Api = weatherApi,
): Promise<Map<string, DayWeather>> {
  const out = new Map<string, DayWeather>();
  try {
    const unique = [...new Set(dates)].sort();
    if (unique.length === 0) return out;
    // A day's margin under Open-Meteo's 16-day limit: "today" here is UTC,
    // the place's own date (timezone=auto) can be a day behind.
    const lastForecast = addDays(today, FORECAST_DAYS - 1);
    const forecastDates = unique.filter((d) => d >= today && d <= lastForecast);

    if (forecastDates.length) {
      const rows = await cached("f", { ...coords, start: forecastDates[0]!, end: forecastDates.at(-1)! }, api, 3 * 3_600_000);
      for (const r of rows ?? []) if (forecastDates.includes(r.date)) out.set(r.date, { ...r, kind: "forecast" });
    }

    // Everything without a forecast -- beyond the window, or the forecast
    // failed -- gets what's typical for the date instead.
    const typicalDates = unique.filter((d) => !out.has(d));
    if (typicalDates.length) {
      // Shift every date back by the same whole number of years, so a trip
      // over New Year keeps its order (Dec 28 -> Jan 3 stays a forward range)
      // and every shifted date is in the past.
      const shift = (iso: string, k: number) => inYear(iso, Number(iso.slice(0, 4)) - k);
      // The most recent years whose dates are all safely past (the archive lags ~5 days).
      const archivedUpTo = addDays(today, -6);
      let firstOffset = 1;
      while (shift(typicalDates.at(-1)!, firstOffset) > archivedUpTo) firstOffset++;
      const offsets = Array.from({ length: TYPICAL_YEARS }, (_, i) => firstOffset + i);
      const perOffset = await Promise.all(
        offsets.map((k) =>
          cached("h", { ...coords, start: shift(typicalDates[0]!, k), end: shift(typicalDates.at(-1)!, k) }, api, 7 * 86_400_000),
        ),
      );
      for (const date of typicalDates) {
        const samples = perOffset.flatMap((rows, i) => rows?.filter((r) => r.date === shift(date, offsets[i]!)) ?? []);
        if (samples.length === 0) continue;
        const precip = samples.map((s) => s.precipMm).filter((p): p is number => p !== undefined);
        out.set(date, {
          date,
          kind: "typical",
          years: samples.length,
          highC: avg(samples.map((s) => s.highC)),
          lowC: avg(samples.map((s) => s.lowC)),
          precipMm: avg(precip),
          rainChancePct: precip.length ? Math.round((precip.filter((p) => p >= 1).length / precip.length) * 100) : undefined,
          elevationM: samples[0]?.elevationM,
        });
      }
    }
  } catch (err) {
    console.error("weatherForDates failed:", err);
  }
  return out;
}

/**
 * Warnings for an outdoor stop on a day with this weather. Worded for
 * forecast vs typical: a typical rainy day is "often rainy on this date", not
 * "rain expected".
 */
export function weatherWarnings(w: DayWeather | undefined, outdoorType?: string): string[] {
  if (!w) return [];
  const typical = w.kind === "typical";
  const out: string[] = [];
  if (w.highC !== undefined && w.highC >= 35) {
    out.push(`${typical ? "Usually very hot" : "Very hot"} (around ${Math.round(w.highC)}°C): go early, avoid midday, carry plenty of water.`);
  } else if (w.highC !== undefined && w.highC >= 30) {
    out.push(`${typical ? "Usually hot" : "Hot"} (around ${Math.round(w.highC)}°C): start early and carry water.`);
  }
  const wet = (w.rainChancePct ?? 0) >= 60 || (w.precipMm ?? 0) >= 5;
  if (wet) {
    out.push(
      typical
        ? "Often rainy on this date: paths can be slippery, so have a backup plan."
        : "Rain likely: paths can be slippery, so have a backup plan.",
    );
  }
  if (w.lowC !== undefined && w.lowC <= 0) out.push("Freezing temperatures: ice is possible on trails.");
  if ((outdoorType === "beach" || outdoorType === "water") && w.highC !== undefined && w.highC < 20) {
    out.push(`${typical ? "Usually cool" : "Cool"} for swimming (around ${Math.round(w.highC)}°C).`);
  }
  return out;
}

/**
 * One line per destination (max 3) of typical conditions over the trip's
 * dates (max 21 days), for the itinerary agent to plan around. Undefined if
 * nothing could be looked up -- planning never waits on or fails for this.
 */
export async function climateSummary(
  destinations: string[],
  start: string | undefined,
  end: string | undefined,
  today?: string,
  api: Api = weatherApi,
): Promise<string | undefined> {
  if (!start || destinations.length === 0) return undefined;
  try {
    const last = end && end >= start ? end : start;
    const dates: string[] = [];
    for (let d = start; d <= last && dates.length < 21; d = addDays(d, 1)) dates.push(d);
    const places = destinations.slice(0, 3);
    const coords = await getPlaceResults(places);
    // All destinations at once: this runs before planning starts.
    const perPlace = await Promise.all(
      places.map(async (place) => {
        const c = coords.get(place.trim())?.coords;
        return { place, days: c ? [...(await weatherForDates(c, dates, today, api)).values()] : [] };
      }),
    );
    const lines: string[] = [];
    for (const { place, days } of perPlace) {
      if (days.length === 0) continue;
      const high = avg(days.map((d) => d.highC));
      const low = avg(days.map((d) => d.lowC));
      const rainy = days.filter((d) => (d.rainChancePct ?? 0) >= 50 || (d.precipMm ?? 0) >= 1).length;
      const kind = days.every((d) => d.kind === "forecast") ? "forecast" : "typical for these dates";
      // A region's centre can be a mountain (Madeira's is ~1,000 m): say so,
      // or the agent plans the coast around mountain weather.
      const elev = days[0]?.elevationM;
      const where = elev !== undefined && elev >= HIGH_POINT_M ? `, at the area's centre, ~${Math.round(elev)} m up; coasts and valleys are usually warmer and drier` : "";
      lines.push(
        `${placeLabel(place)} (${kind}${where}): highs ~${Math.round(high ?? 0)}°C, lows ~${Math.round(low ?? 0)}°C, rain on ~${rainy} of ${days.length} days.`,
      );
    }
    return lines.length ? lines.join("\n") : undefined;
  } catch {
    return undefined;
  }
}
