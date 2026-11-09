import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { centroid, climateSummary, resetWeatherCache, weatherForDates, weatherWarnings, type DayWeather } from "./weather";
import { resetDestinationPhotoCache } from "./destinationPhoto";
import { setWikimediaFetch } from "./wikimedia";

const C = { lat: 38.72, lon: -9.14 };
const TODAY = "2026-11-08";

function api(history: Record<number, { highC: number; lowC: number; precipMm: number }>) {
  return {
    dailyForecast: vi.fn(async (q: { start: string; end: string }) => ({
      ok: true as const,
      data: [{ date: q.start, highC: 20, lowC: 12, precipMm: 0, rainChancePct: 70 }],
    })),
    dailyHistory: vi.fn(async (q: { start: string }) => {
      const year = Number(q.start.slice(0, 4));
      const h = history[year];
      return h ? { ok: true as const, data: [{ date: q.start, ...h }] } : { ok: false as const, reason: "NO_AVAILABILITY" as const };
    }),
  };
}

beforeEach(() => resetWeatherCache());

describe("weatherForDates", () => {
  it("forecast within the window, typical (averaged over past years) beyond it", async () => {
    // The most recent past years: June 2027 averages June 2026, 2025 and 2024.
    const a = api({ 2026: { highC: 30, lowC: 18, precipMm: 0 }, 2025: { highC: 26, lowC: 16, precipMm: 3 }, 2024: { highC: 28, lowC: 17, precipMm: 0 } });
    const r = await weatherForDates(C, ["2026-11-10", "2027-06-15"], TODAY, a);
    expect(r.get("2026-11-10")).toMatchObject({ kind: "forecast", highC: 20, rainChancePct: 70 });
    expect(r.get("2027-06-15")).toMatchObject({ date: "2027-06-15", kind: "typical", years: 3, highC: 28, lowC: 17, precipMm: 1, rainChancePct: 33 });
    expect(a.dailyHistory).toHaveBeenCalledWith({ ...C, start: "2026-06-15", end: "2026-06-15" });
  });

  it("a trip over New Year keeps a forward range in each past year (review fix)", async () => {
    const a = api({});
    await weatherForDates(C, ["2027-12-30", "2028-01-02"], TODAY, a);
    for (const [q] of a.dailyHistory.mock.calls as Array<[{ start: string; end: string }]>) expect(q.start < q.end).toBe(true);
    expect(a.dailyHistory).toHaveBeenCalledWith({ ...C, start: "2025-12-30", end: "2026-01-02" });
  });

  it("dates whose forecast fails fall back to typical (review fix)", async () => {
    const a = api({ 2025: { highC: 22, lowC: 15, precipMm: 0 } });
    a.dailyForecast.mockImplementation(async () => ({ ok: false, reason: "PROVIDER_ERROR", message: "400", retryable: false }) as never);
    const r = await weatherForDates(C, ["2026-11-10"], TODAY, a);
    expect(r.get("2026-11-10")).toMatchObject({ kind: "typical", highC: 22 });
  });

  it("29 February maps to 28 February in other years", async () => {
    const a = api({ 2026: { highC: 15, lowC: 8, precipMm: 0 } });
    await weatherForDates(C, ["2028-02-29"], TODAY, a);
    expect(a.dailyHistory).toHaveBeenCalledWith({ ...C, start: "2026-02-28", end: "2026-02-28" });
  });

  it("caches, and never throws", async () => {
    const a = api({ 2025: { highC: 15, lowC: 8, precipMm: 0 } });
    await weatherForDates(C, ["2027-06-15"], TODAY, a);
    await weatherForDates(C, ["2027-06-15"], TODAY, a);
    expect(a.dailyHistory).toHaveBeenCalledTimes(3); // 3 years, once each
    const boom = { dailyForecast: async () => { throw new Error("x"); }, dailyHistory: async () => { throw new Error("x"); } };
    expect((await weatherForDates(C, ["2026-11-10"], TODAY, boom as never)).size).toBe(0);
  });
});

describe("weatherWarnings", () => {
  const w = (o: Partial<DayWeather>): DayWeather => ({ date: "d", kind: "forecast", ...o });
  it("heat, rain, ice, cold water -- worded by forecast vs typical", () => {
    expect(weatherWarnings(w({ highC: 33 }))).toEqual(["Hot (around 33°C): start early and carry water."]);
    expect(weatherWarnings(w({ highC: 36, kind: "typical" }))[0]).toMatch(/^Usually very hot/);
    expect(weatherWarnings(w({ rainChancePct: 80 }))).toEqual(["Rain likely: paths can be slippery, so have a backup plan."]);
    expect(weatherWarnings(w({ rainChancePct: 67, kind: "typical" }))).toEqual(["Often rainy on this date: paths can be slippery, so have a backup plan."]);
    expect(weatherWarnings(w({ lowC: -2 }))).toEqual(["Freezing temperatures: ice is possible on trails."]);
    expect(weatherWarnings(w({ highC: 17 }), "beach")).toEqual(["Cool for swimming (around 17°C)."]);
    expect(weatherWarnings(w({ highC: 24, rainChancePct: 10 }), "hike")).toEqual([]);
    expect(weatherWarnings(undefined)).toEqual([]);
  });
});

describe("climateSummary", () => {
  beforeEach(() => {
    resetDestinationPhotoCache();
    setWikimediaFetch(async (url) => ({
      ok: true,
      status: 200,
      json: async () =>
        new URL(url).searchParams.get("prop")?.includes("coordinates")
          ? { query: { pages: [{ title: "Lisbon", coordinates: [{ lat: C.lat, lon: C.lon }] }] } }
          : { query: { pages: [] } },
    }));
  });
  afterEach(() => setWikimediaFetch(null));

  it("one line per destination, for the agent", async () => {
    const a = api({ 2025: { highC: 30, lowC: 18, precipMm: 0 }, 2024: { highC: 26, lowC: 16, precipMm: 3 }, 2023: { highC: 28, lowC: 17, precipMm: 0 } });
    const s = await climateSummary(["Lisbon"], "2027-06-15", "2027-06-15", TODAY, a);
    expect(s).toBe("Lisbon (typical for these dates): highs ~28°C, lows ~17°C, rain on ~1 of 1 days.");
  });

  it("says when the point is high up, so the agent doesn't plan the coast around mountain weather (seen live: Madeira)", async () => {
    const a = {
      dailyForecast: vi.fn(),
      dailyHistory: vi.fn(async (q: { start: string }) => ({
        ok: true as const,
        data: [{ date: q.start, highC: 15, lowC: 7, precipMm: 4, elevationM: 1050 }],
      })),
    };
    const s = await climateSummary(["Lisbon"], "2027-05-15", "2027-05-15", TODAY, a as never);
    expect(s).toContain("at the area's centre, ~1050 m up; coasts and valleys are usually warmer and drier");
  });

  it("nothing to say without dates or data", async () => {
    expect(await climateSummary(["Lisbon"], undefined, undefined, TODAY, api({}))).toBeUndefined();
    expect(await climateSummary(["Lisbon"], "2027-06-15", "2027-06-16", TODAY, api({}))).toBeUndefined();
  });
});

describe("centroid", () => {
  it("averages points, ignoring missing ones", () => {
    expect(centroid([{ lat: 0, lon: 0 }, undefined, { lat: 2, lon: 4 }])).toEqual({ lat: 1, lon: 2 });
    expect(centroid([undefined])).toBeUndefined();
  });
});
