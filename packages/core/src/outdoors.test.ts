import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OutdoorNeedsSchema,
  impliedDifficulty,
  mergeOutdoorNeeds,
  normalizeAccessTags,
  normalizeDifficulty,
  outdoorFlags,
  outdoorNeedLabels,
  type OutdoorNeeds,
} from "./outdoors";
import { outdoorView, trailLengthNote } from "./outdoorView";
import { OUTDOOR_SPEC, nameMatches, restaurantKey } from "./restaurantChecks";
import { checkTrails, resetTrailCache } from "./trailChecks";
import { planExtras } from "./food";
import { ActivityDraftSchema, TripBriefSchema } from "./agents/types";
import { resetDestinationPhotoCache } from "./destinationPhoto";
import { setWikimediaFetch } from "./wikimedia";

const needs = (v: unknown): OutdoorNeeds => OutdoorNeedsSchema.parse(v);

describe("needs", () => {
  it("normalises loose wording", () => {
    // Review fix: a negated "hard" word is a limit, not a request for hard hikes.
    expect(normalizeDifficulty("nothing too strenuous")).toBe("moderate");
    expect(normalizeDifficulty("not too difficult")).toBe("moderate");
    expect(normalizeDifficulty("easy to moderate")).toBe("moderate");
    expect(normalizeDifficulty("Challenging")).toBe("hard");
    expect(normalizeDifficulty("Easy")).toBe("easy");
    expect(normalizeDifficulty("intermediate")).toBe("moderate");
    expect(normalizeAccessTags("bad knees, travelling with a toddler")).toEqual(["limited_mobility", "young_kids"]);
    expect(normalizeAccessTags("wheelchair user")).toEqual(["wheelchair"]);
  });

  it("accepts the tag values themselves (what the picker and the concierge send)", () => {
    expect(needs({ access: ["young_kids", "limited_mobility", "wheelchair"] }).access).toEqual(["young_kids", "limited_mobility", "wheelchair"]);
  });

  it("lenient: junk fields don't wipe the rest", () => {
    expect(needs({ maxDifficulty: 7, access: ["Young kids", null], notes: "x".repeat(400) })).toEqual({
      maxDifficulty: undefined,
      access: ["young_kids"],
      notes: "x".repeat(300),
    });
  });

  it("merging keeps the stricter limit and all access needs", () => {
    const m = mergeOutdoorNeeds(needs({ maxDifficulty: "moderate", access: ["young_kids"] }), needs({ maxDifficulty: "easy" }));
    expect(m.maxDifficulty).toBe("easy");
    expect(m.access).toEqual(["young_kids"]);
    expect(mergeOutdoorNeeds(undefined, null)).toEqual({ maxDifficulty: undefined, access: [], notes: undefined });
  });

  it("notes don't pile up across clarification rounds (review fix)", () => {
    const round1 = mergeOutdoorNeeds(needs({ notes: "afraid of heights" }), needs({ notes: "bad knees" }));
    const round2 = mergeOutdoorNeeds(needs({ notes: "afraid of heights" }), round1);
    expect(round2.notes).toBe("afraid of heights; bad knees");
  });

  it("labels skip 'anything goes'", () => {
    expect(outdoorNeedLabels(needs({ maxDifficulty: "easy", access: ["wheelchair"] }))).toEqual(["Easy walks only", "Wheelchair access"]);
    expect(outdoorNeedLabels(needs({ maxDifficulty: "hard" }))).toEqual([]);
  });

  it("briefs default to no needs", () => {
    expect(TripBriefSchema.parse({ destinations: ["Lisbon"], budgetTotalCents: 1 }).outdoors).toEqual({
      maxDifficulty: undefined,
      access: [],
      notes: undefined,
    });
  });
});

describe("outdoorFlags", () => {
  it("implied difficulty from the numbers", () => {
    expect(impliedDifficulty(5, 100)).toBe("easy");
    expect(impliedDifficulty(10, 200)).toBe("moderate");
    expect(impliedDifficulty(6, 900)).toBe("hard");
    expect(impliedDifficulty()).toBeUndefined();
  });

  it("flags an 'easy' hike whose numbers say otherwise, even without needs", () => {
    expect(outdoorFlags({ type: "hike", difficulty: "easy", distanceKm: 12, elevationGainM: 900 }, undefined)).toEqual([
      "Called easy, but 12 km with 900 m of climbing is more like hard.",
    ]);
  });

  it("flags outings over the traveller's limit", () => {
    const f = outdoorFlags({ type: "hike", difficulty: "moderate" }, needs({ maxDifficulty: "easy" }));
    expect(f).toEqual(["This is a moderate outing; you asked for easy walks only."]);
  });

  it("access needs", () => {
    expect(outdoorFlags({ type: "hike", difficulty: "easy" }, needs({ access: ["wheelchair"] }))).toEqual([
      "Step-free access isn't confirmed for this outing.",
    ]);
    expect(outdoorFlags({ type: "hike", elevationGainM: 400 }, needs({ access: ["limited_mobility"] }))[0]).toMatch(/limited mobility/);
    expect(outdoorFlags({ type: "walk", distanceKm: 10 }, needs({ access: ["young_kids"] }))).toContain("Long or hard for young kids.");
    expect(outdoorFlags({ type: "beach" }, needs({ access: ["young_kids"] }))).toEqual([]);
  });

  it("an easy outing within limits is fine", () => {
    expect(outdoorFlags({ type: "walk", difficulty: "easy", distanceKm: 4, elevationGainM: 50 }, needs({ maxDifficulty: "easy" }))).toEqual([]);
  });
});

describe("outdoor place names (Google check)", () => {
  it.each([
    ["Sintra-Cascais Natural Park", "Parque Natural de Sintra-Cascais"],
    ["Praia da Ursa", "Praia da Ursa"],
    ["Cabo da Roca", "Cabo da Roca"],
  ])("%s matches %s", (a, b) => {
    expect(nameMatches(a, b, "Lisbon", OUTDOOR_SPEC.generic)).toBe(true);
  });

  it("ignores a ', town' suffix (seen live)", () => {
    expect(nameMatches("Queimadas, Santana", "Parque Florestal das Queimadas", "Madeira", OUTDOOR_SPEC.generic)).toBe(true);
  });

  it("doesn't match on generic words alone", () => {
    expect(nameMatches("Arrábida Natural Park", "Sintra-Cascais Natural Park", "Lisbon", OUTDOOR_SPEC.generic)).toBe(false);
    expect(nameMatches("Praia da Ursa", "Praia do Guincho", "Lisbon", OUTDOOR_SPEC.generic)).toBe(false);
  });
});

describe("outdoorView", () => {
  it("links the verified place, the trail map, and notes a big length mismatch", () => {
    const v = outdoorView(
      { type: "hike", difficulty: "moderate", distanceKm: 5, placeName: "Praia da Ursa", trailName: "Trilho X" },
      "Lisbon",
      undefined,
      {
        places: { [restaurantKey("Praia da Ursa")]: { status: "OPEN", name: "Praia da Ursa", googleMapsUri: "https://maps.google.com/?cid=9" } },
        trails: { [restaurantKey("Trilho X")]: { status: "FOUND", name: "Trilho X", lengthKm: 12, url: "https://hiking.waymarkedtrails.org/#route?id=1&type=relation" } },
      },
    );
    expect(v.links.map((l) => l.provider)).toEqual(["Google Maps", "Trail map"]);
    expect(v.links[0]!.url).toBe("https://maps.google.com/?cid=9");
    expect(v.trailNote).toMatch(/12 km; the plan says 5 km/);
  });

  it("no length note for an out-and-back walk (about twice the mapped length, seen live)", () => {
    expect(trailLengthNote(13, { status: "FOUND", name: "PR 9", lengthKm: 8.4, url: "u" })).toBeUndefined();
  });

  it("no length note for long routes walked in sections, or close numbers", () => {
    const found = (lengthKm: number) => ({ status: "FOUND" as const, name: "R", lengthKm, url: "u" });
    expect(trailLengthNote(10, found(220))).toBeUndefined();
    expect(trailLengthNote(10, found(12))).toBeUndefined();
    expect(trailLengthNote(10, { status: "NOT_FOUND" })).toBeUndefined();
  });

  it("malformed outdoor blocks are dropped, not fatal", () => {
    expect(ActivityDraftSchema.parse({ title: "Walk", outdoor: "a nice walk" }).outdoor).toBeUndefined();
    const p = ActivityDraftSchema.parse({ title: "Hike", outdoor: { type: "trek", difficulty: "Strenuous", distanceKm: "12.5", elevationGainM: -3 } });
    expect(p.outdoor).toMatchObject({ type: "nature", difficulty: "hard", distanceKm: 12.5, elevationGainM: undefined });
  });
});

describe("planExtras outdoor", () => {
  it("attaches outdoor views with flags by day and position", () => {
    const draft = { days: [{ dayIndex: 0, activities: [{ title: "Hike", outdoor: { type: "hike", difficulty: "hard" } }] }] };
    const saved = [{ dayIndex: 0, activities: [{ id: "h", order: 0, title: "Hike" }] }];
    const r = planExtras(saved, JSON.stringify(draft), { outdoors: needs({ maxDifficulty: "easy" }) }, () => "Lisbon", ["Lisbon"]);
    expect(r.outdoor.get("h")?.flags).toEqual(["This is a hard outing; you asked for easy walks only."]);
  });
});

describe("checkTrails", () => {
  const LISBON = { lat: 38.72, lon: -9.14 };
  beforeEach(() => {
    resetTrailCache();
    resetDestinationPhotoCache();
    setWikimediaFetch(async (url) => ({
      ok: true,
      status: 200,
      json: async () =>
        new URL(url).searchParams.get("prop")?.includes("coordinates")
          ? { query: { pages: [{ title: "Lisbon", coordinates: [{ lat: LISBON.lat, lon: LISBON.lon }] }] } }
          : { query: { pages: [] } },
    }));
  });
  afterEach(() => setWikimediaFetch(null));

  const draft = (trailName: string) => ({ days: [{ activities: [{ title: "Hike", outdoor: { trailName } }] }] });
  const api = (results: Array<{ id: number; name: string }>, details: Record<number, { centre?: { lat: number; lon: number }; lengthM?: number }>) => ({
    searchTrails: vi.fn(async () => (results.length ? { ok: true as const, data: results } : { ok: false as const, reason: "NO_AVAILABILITY" as const })),
    trailDetails: vi.fn(async (id: number) => ({ ok: true as const, data: { id, name: results.find((r) => r.id === id)!.name, url: `u${id}`, ...details[id] } })),
  });

  it("finds the main route near the trip, preferring it over side routes", async () => {
    const a = api(
      [
        { id: 1, name: "Alternativa Trilho dos Pescadores" },
        { id: 2, name: "Rota Vicentina - Trilho dos Pescadores" },
      ],
      { 1: { centre: { lat: 37.5, lon: -8.8 }, lengthM: 5000 }, 2: { centre: { lat: 37.6, lon: -8.8 }, lengthM: 75400 } },
    );
    const r = await checkTrails([draft("Trilho dos Pescadores")], ["Lisbon"], a);
    expect(r[0]![restaurantKey("Trilho dos Pescadores")]).toEqual({ status: "FOUND", name: "Rota Vicentina - Trilho dos Pescadores", lengthKm: 75.4, url: "u2" });
  });

  it("a same-name route far away is not it; no matching name is NOT_FOUND", async () => {
    const far = api([{ id: 3, name: "Trilho dos Pescadores" }], { 3: { centre: { lat: 50, lon: 10 } } });
    expect((await checkTrails([draft("Trilho dos Pescadores")], ["Lisbon"], far))[0]![restaurantKey("Trilho dos Pescadores")]).toEqual({ status: "NOT_FOUND" });
    resetTrailCache();
    const other = api([{ id: 4, name: "Sint Jacobsroute" }], {});
    expect((await checkTrails([draft("Sintra Trail")], ["Lisbon"], other))[0]![restaurantKey("Sintra Trail")]).toEqual({ status: "NOT_FOUND" });
  });

  it("caches, and never throws", async () => {
    const a = api([{ id: 2, name: "Trilho dos Pescadores" }], { 2: { centre: { lat: 37.6, lon: -8.8 } } });
    await checkTrails([draft("Trilho dos Pescadores")], ["Lisbon"], a);
    await checkTrails([draft("Trilho dos Pescadores")], ["Lisbon"], a);
    expect(a.searchTrails).toHaveBeenCalledTimes(1);
    const boom = { searchTrails: async () => { throw new Error("x"); }, trailDetails: async () => { throw new Error("x"); } };
    resetTrailCache();
    expect(await checkTrails([draft("Trilho dos Pescadores")], ["Lisbon"], boom as never)).toEqual([{}]);
  });
});

describe("review fixes: outdoor/trail checks", () => {
  afterEach(() => setWikimediaFetch(null));

  it("outdoor places aren't called 'not found' when the city's coordinates are unknown", async () => {
    resetDestinationPhotoCache();
    setWikimediaFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const { checkOutdoorPlaces } = await import("./restaurantChecks");
    const find = vi.fn(async () => ({
      ok: true as const,
      data: [{ placeId: "p", name: "Parque Natural da Arrábida", formattedAddress: "Setúbal, Portugal", types: [] }],
    }));
    const r = await checkOutdoorPlaces(
      [{ days: [{ activities: [{ title: "Walk", outdoor: { placeName: "Parque Natural da Arrábida" } }] }] }],
      ["Lisbon"],
      find,
    );
    expect(r.perOption[0]).toEqual({});
    expect(find).not.toHaveBeenCalled();
  });

  it("restaurant and outdoor checks share one Places concurrency limit", async () => {
    resetDestinationPhotoCache();
    setWikimediaFetch(async (url) => ({
      ok: true,
      status: 200,
      json: async () =>
        new URL(url).searchParams.get("prop")?.includes("coordinates")
          ? { query: { pages: [{ title: "Lisbon", coordinates: [{ lat: 38.72, lon: -9.14 }] }] } }
          : { query: { pages: [] } },
    }));
    const { checkOutdoorPlaces, checkRestaurants } = await import("./restaurantChecks");
    let inFlight = 0;
    let max = 0;
    const find = async () => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { ok: false as const, reason: "NO_AVAILABILITY" as const };
    };
    const names = Array.from({ length: 8 }, (_, i) => `Place${i} Spot`);
    const draft = { days: [{ activities: names.map((n) => ({ title: n, dining: { restaurantName: n }, outdoor: { placeName: n } })) }] };
    await Promise.all([checkRestaurants([draft], ["Lisbon"], find), checkOutdoorPlaces([draft], ["Lisbon"], find)]);
    expect(max).toBeLessThanOrEqual(4);
  });

  it("trails: a cached run makes no calls at all, and a provider error stops further lookups", async () => {
    resetTrailCache();
    resetDestinationPhotoCache();
    let wikiCalls = 0;
    setWikimediaFetch(async (url) => {
      wikiCalls++;
      return {
        ok: true,
        status: 200,
        json: async () =>
          new URL(url).searchParams.get("prop")?.includes("coordinates")
            ? { query: { pages: [{ title: "Lisbon", coordinates: [{ lat: 38.72, lon: -9.14 }] }] } }
            : { query: { pages: [] } },
      };
    });
    const draft = (...names: string[]) => ({ days: [{ activities: names.map((n) => ({ title: n, outdoor: { trailName: n } })) }] });
    const failing = { searchTrails: vi.fn(async () => ({ ok: false as const, reason: "PROVIDER_ERROR" as const, message: "503", retryable: true })), trailDetails: vi.fn() };
    await checkTrails([draft("Trilho Alpha", "Trilho Beta", "Trilho Gamma")], ["Lisbon"], failing as never);
    expect(failing.searchTrails).toHaveBeenCalledTimes(1);

    const none = { searchTrails: vi.fn(async () => ({ ok: false as const, reason: "NO_AVAILABILITY" as const })), trailDetails: vi.fn() };
    await checkTrails([draft("Trilho Alpha")], ["Lisbon"], none);
    const before = wikiCalls;
    await checkTrails([draft("Trilho Alpha")], ["Lisbon"], none);
    expect(none.searchTrails).toHaveBeenCalledTimes(1);
    expect(wikiCalls).toBe(before);
  });
});
