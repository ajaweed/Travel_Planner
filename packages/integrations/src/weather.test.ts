import { afterEach, describe, expect, it, vi } from "vitest";
import { dailyForecast, dailyHistory } from "./weather";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

describe("weather (Open-Meteo)", () => {
  it("asks for the right fields and maps the daily arrays", async () => {
    let url = "";
    vi.stubGlobal("fetch", vi.fn(async (u: URL) => {
      url = String(u);
      return json({ daily: { time: ["2027-06-15"], temperature_2m_max: [28.1], temperature_2m_min: [17], precipitation_sum: [0], precipitation_probability_max: [10] } });
    }));
    const r = await dailyForecast({ lat: 38.72, lon: -9.14, start: "2027-06-15", end: "2027-06-15" });
    expect(url).toContain("api.open-meteo.com/v1/forecast");
    expect(url).toContain("precipitation_probability_max");
    expect(r).toEqual({ ok: true, data: [{ date: "2027-06-15", highC: 28.1, lowC: 17, precipMm: 0, rainChancePct: 10 }] });
  });

  it("history uses the archive API; errors never throw", async () => {
    let url = "";
    vi.stubGlobal("fetch", vi.fn(async (u: URL) => {
      url = String(u);
      return json({ daily: { time: ["2025-06-15"], temperature_2m_max: [null] } });
    }));
    const r = await dailyHistory({ lat: 1, lon: 2, start: "2025-06-15", end: "2025-06-15" });
    expect(url).toContain("archive-api.open-meteo.com");
    expect(r).toEqual({ ok: true, data: [{ date: "2025-06-15", highC: undefined, lowC: undefined, precipMm: undefined, rainChancePct: undefined }] });
    vi.stubGlobal("fetch", vi.fn(async () => json({ reason: "out of range" }, 400)));
    expect(await dailyHistory({ lat: 1, lon: 2, start: "x", end: "y" })).toEqual({ ok: false, reason: "NO_AVAILABILITY" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await dailyForecast({ lat: 1, lon: 2, start: "x", end: "y" })).toMatchObject({ ok: false, reason: "PROVIDER_ERROR" });
  });
});
