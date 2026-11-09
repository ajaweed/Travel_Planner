// Daily weather from Open-Meteo (https://open-meteo.com): free, no key.
//   forecast: api.open-meteo.com/v1/forecast       (up to 16 days ahead)
//   history:  archive-api.open-meteo.com/v1/archive (past years, for "typical")
// Read-only. Open-Meteo's free tier is for non-commercial use; a commercial
// launch needs their paid plan (docs/going-live.md).

import type { ProviderResult } from "./types";

const FORECAST = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
const TIMEOUT_MS = 8_000;

export type DailyWeather = {
  date: string; // YYYY-MM-DD, local to the place
  highC?: number;
  lowC?: number;
  precipMm?: number;
  /** Forecast only: the day's highest hourly chance of precipitation. */
  rainChancePct?: number;
  /** Elevation of the point the data is for, metres (a region's centre can be a mountain). */
  elevationM?: number;
};

export type WeatherQuery = { lat: number; lon: number; start: string; end: string };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

async function daily(base: string, q: WeatherQuery, fields: string[]): Promise<ProviderResult<DailyWeather[]>> {
  const u = new URL(base);
  u.searchParams.set("latitude", q.lat.toFixed(4));
  u.searchParams.set("longitude", q.lon.toFixed(4));
  u.searchParams.set("start_date", q.start);
  u.searchParams.set("end_date", q.end);
  u.searchParams.set("daily", fields.join(","));
  u.searchParams.set("timezone", "auto");
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 429) return { ok: false, reason: "RATE_LIMITED", retryAfterMs: 60_000 };
    // 400 = a request Open-Meteo won't serve (e.g. dates out of range): an
    // error, not "no weather here", so callers don't remember it as an answer.
    if (res.status === 400) return { ok: false, reason: "PROVIDER_ERROR", message: "Open-Meteo rejected the request (400)", retryable: false };
    if (!res.ok) return { ok: false, reason: "PROVIDER_ERROR", message: `Open-Meteo ${res.status}`, retryable: res.status >= 500 };
    const body = (await res.json()) as { daily?: unknown; elevation?: unknown };
    const d: any = body?.daily ?? {};
    const elevationM = num(body?.elevation);
    const dates: unknown[] = Array.isArray(d.time) ? d.time : [];
    const out = dates.flatMap((t, i): DailyWeather[] =>
      typeof t === "string"
        ? [
            {
              date: t,
              highC: num(d.temperature_2m_max?.[i]),
              lowC: num(d.temperature_2m_min?.[i]),
              precipMm: num(d.precipitation_sum?.[i]),
              rainChancePct: num(d.precipitation_probability_max?.[i]),
              elevationM,
            },
          ]
        : [],
    );
    return out.length ? { ok: true, data: out } : { ok: false, reason: "NO_AVAILABILITY" };
  } catch (err) {
    return { ok: false, reason: "PROVIDER_ERROR", message: err instanceof Error ? err.message : String(err), retryable: true };
  }
}

/** Forecast for dates within the next ~16 days. */
export function dailyForecast(q: WeatherQuery): Promise<ProviderResult<DailyWeather[]>> {
  return daily(FORECAST, q, ["temperature_2m_max", "temperature_2m_min", "precipitation_sum", "precipitation_probability_max"]);
}

/** Observed weather for past dates (reanalysis), for "typical for these dates". */
export function dailyHistory(q: WeatherQuery): Promise<ProviderResult<DailyWeather[]>> {
  return daily(ARCHIVE, q, ["temperature_2m_max", "temperature_2m_min", "precipitation_sum"]);
}
