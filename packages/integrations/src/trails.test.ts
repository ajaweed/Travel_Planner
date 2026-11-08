import { afterEach, describe, expect, it, vi } from "vitest";
import { mercatorToLatLon, searchTrails, trailDetails } from "./trails";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("trails (Waymarked Trails)", () => {
  it("converts web-mercator to lat/lon", () => {
    const p = mercatorToLatLon(-971_000, 4_554_800); // near Porto Covo
    expect(p.lat).toBeCloseTo(37.85, 1);
    expect(p.lon).toBeCloseTo(-8.72, 1);
  });

  it("search keeps relations with names, identifies the app, and maps no results", async () => {
    let init: RequestInit | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, i?: RequestInit) => {
      init = i;
      return json({ results: [{ type: "relation", id: 1, name: "A", ref: "R" }, { type: "way", id: 2, name: "B" }, { type: "relation", id: 3 }] });
    }));
    expect(await searchTrails("A")).toEqual({ ok: true, data: [{ id: 1, name: "A", ref: "R", group: undefined }] });
    expect((init?.headers as Record<string, string>)["User-Agent"]).toMatch(/^TripPlannerAI\/0\.1 \(/);
    vi.stubGlobal("fetch", vi.fn(async () => json({ results: [] })));
    expect(await searchTrails("nothing")).toEqual({ ok: false, reason: "NO_AVAILABILITY" });
    expect(await searchTrails("  ")).toEqual({ ok: false, reason: "NO_AVAILABILITY" });
  });

  it("details: mapped length, bbox centre, link", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      json({ name: "Trilho", route: { length: 17910 }, official_length: 16500, bbox: [-978870, 4551138, -965365, 4558540], operator: "Rota Vicentina" }),
    ));
    const r = await trailDetails(8492495);
    expect(r.ok && r.data).toMatchObject({ name: "Trilho", lengthM: 17910, operator: "Rota Vicentina", url: "https://hiking.waymarkedtrails.org/#route?id=8492495&type=relation" });
    expect(r.ok && r.data.centre?.lat).toBeCloseTo(37.85, 1);
  });

  it("errors map to provider results, never throw", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 404)));
    expect(await trailDetails(1)).toEqual({ ok: false, reason: "NO_AVAILABILITY" });
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 503)));
    expect(await trailDetails(1)).toMatchObject({ ok: false, reason: "PROVIDER_ERROR", retryable: true });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await searchTrails("x")).toMatchObject({ ok: false, reason: "PROVIDER_ERROR" });
  });
});
