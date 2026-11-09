// Day weather chip and outdoor weather warnings. Always says whether it's a
// forecast or what's typical for the date: a typical 24°C is not a promise.

import { CloudRain, CloudSun, Snowflake, Sun, ThermometerSun, type LucideIcon } from "lucide-react";
// Type-only import: erased at build, so no server code reaches the client.
import type { DayWeather as CoreDayWeather } from "@trip-planner/core";

export type DayWeather = CoreDayWeather & {
  city?: string;
  /** Which point the weather is for: the day's verified stops, the hotel, or the destination's centre. */
  where?: "stops" | "hotel" | "destination";
};

const WHERE: Record<string, string> = {
  stops: "around the day's stops",
  hotel: "at your hotel",
  destination: "at the destination's centre",
};

/** Above this, a reading is labelled with its elevation (core HIGH_POINT_M). */
const HIGH_POINT_M = 500;

function icon(w: DayWeather): LucideIcon {
  if ((w.lowC ?? 99) <= 0) return Snowflake;
  if ((w.rainChancePct ?? 0) >= 50 || (w.precipMm ?? 0) >= 2) return CloudRain;
  if ((w.highC ?? 0) >= 28) return Sun;
  return CloudSun;
}

export function WeatherChip({ weather }: { weather?: DayWeather }) {
  if (!weather || (weather.highC === undefined && weather.lowC === undefined)) return null;
  const Icon = icon(weather);
  const temps = [weather.highC, weather.lowC].map((t) => (t === undefined ? "–" : `${Math.round(t)}°`)).join(" / ");
  const rain = weather.rainChancePct !== undefined ? ` · ${weather.rainChancePct}% ${weather.kind === "typical" ? "rainy" : "rain"}` : "";
  const label =
    weather.kind === "forecast"
      ? "Forecast"
      : `Typical for this date${weather.years ? ` (last ${weather.years} years)` : ""}`;
  // A region's centre can be a mountain: say so rather than pass it off as the coast.
  const high = weather.where === "destination" && (weather.elevationM ?? 0) >= HIGH_POINT_M;
  return (
    <p
      className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-sand-100 px-2.5 py-1 text-xs text-ink-700 tabular-nums"
      title={`${label}, ${WHERE[weather.where ?? "destination"]}${weather.city ? ` (${weather.city})` : ""}. Weather data: Open-Meteo.`}
    >
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
      <span className="font-medium">{temps}</span>
      <span>{rain}</span>
      <span className="text-ink-500">· {weather.kind === "forecast" ? "forecast" : "typical"}</span>
      {high && <span className="text-ink-500">· at {Math.round(weather.elevationM!).toLocaleString("en-US")} m</span>}
    </p>
  );
}

export function WeatherWarnings({ warnings }: { warnings?: string[] }) {
  if (!warnings?.length) return null;
  return (
    <div className="mt-1.5 space-y-0.5 text-xs font-medium text-warning-700">
      {warnings.map((w) => (
        <p key={w} className="flex items-start gap-1.5">
          <ThermometerSun size={14} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0" />
          {w}
        </p>
      ))}
    </div>
  );
}
