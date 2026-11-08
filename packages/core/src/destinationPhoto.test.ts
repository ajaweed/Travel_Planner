import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_COLD_LOOKUPS_PER_MINUTE,
  buildSrcSet,
  candidateTitles,
  distanceKm,
  getPlaceResults,
  lookupDestinationPhoto,
  lookupDestinationPhotos,
  photoCacheKey,
  placeLabel,
  plainText,
  resetDestinationPhotoCache,
  type DestinationPhoto,
  type PlaceResult,
} from "./destinationPhoto";
import { WikimediaUnavailable, setWikimediaFetch } from "./wikimedia";
import { fakeWikimedia, type FakeWiki } from "./__fixtures__/fakeWikimedia";

function use(wiki: FakeWiki) {
  const fake = fakeWikimedia(wiki);
  setWikimediaFetch(fake.fn);
  return fake;
}

afterEach(() => setWikimediaFetch(null));

describe("lookupDestinationPhotos", () => {
  it("returns a credited photo and coordinates", async () => {
    use({ wikipedia: { Lisbon: { image: "Lisboa.jpg", coords: [38.7, -9.1] } }, files: { "Lisboa.jpg": {} } });
    const r = (await lookupDestinationPhotos(["Lisbon"])).get("Lisbon")!;
    expect(r.coords).toEqual({ lat: 38.7, lon: -9.1 });
    expect(r.photo).toMatchObject({
      place: "Lisbon",
      subject: "Lisbon",
      author: "Ana Silva",
      license: "CC BY-SA 4.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Lisboa.jpg",
    });
  });

  it("batches: many places cost one page request and one file request", async () => {
    const fake = use({
      wikipedia: { Lisbon: { image: "L.jpg" }, Kyoto: { image: "K.jpg" }, Dubai: { image: "D.jpg" } },
      files: { "L.jpg": {}, "K.jpg": {}, "D.jpg": {} },
    });
    const r = await lookupDestinationPhotos(["Lisbon", "Kyoto", "Dubai"]);
    expect([...r.values()].every((x) => x.photo)).toBe(true);
    expect(fake.calls).toHaveLength(2);
  });

  it("falls back from 'City, Country' to the city, and follows redirects", async () => {
    use({
      wikipedia: { Lisbon: { redirectTo: "Lisboa" }, Lisboa: { image: "L.jpg" } },
      files: { "L.jpg": {} },
    });
    const r = (await lookupDestinationPhotos(["Lisbon, Portugal"])).get("Lisbon, Portugal")!;
    expect(r.photo?.subject).toBe("Lisboa");
  });

  it("falls back to Wikivoyage when Wikipedia's image is unusable, keeping Wikipedia's coordinates", async () => {
    use({
      wikipedia: { Dubai: { image: "Tower.jpg", coords: [25.2, 55.3] } },
      wikivoyage: { Dubai: { image: "Creek.jpg" } },
      files: { "Tower.jpg": { repo: "local" }, "Creek.jpg": {} },
    });
    const r = (await lookupDestinationPhotos(["Dubai"])).get("Dubai")!;
    expect(r.photo?.sourceUrl).toContain("Creek.jpg");
    expect(r.coords).toEqual({ lat: 25.2, lon: 55.3 });
  });

  it.each([
    ["a flag", "Flag_of_Portugal.jpg", {}],
    ["a map", "Patagonia_map.jpg", {}],
    ["an SVG", "Skyline.svgz", { mime: "image/svg+xml" }],
    ["a PNG", "Skyline.png", { mime: "image/png" }],
    ["a wiki-local file", "Poster.jpg", { repo: "local" }],
    ["a NonFree-flagged file", "Poster.jpg", { nonFree: true }],
    ["an all-rights-reserved file", "Poster.jpg", { license: "All rights reserved" }],
    ["a NonCommercial license", "Poster.jpg", { license: "CC BY-NC-SA 2.0" }],
    ["a NoDerivatives license", "Poster.jpg", { license: "CC BY-ND 4.0" }],
  ])("rejects %s", async (_label, name, file) => {
    use({ wikipedia: { Place: { image: name } }, files: { [name]: file } });
    expect(await lookupDestinationPhoto("Place")).toBeNull();
  });

  it("accepts public domain and CC0", async () => {
    for (const license of ["Public domain", "CC0"]) {
      use({ wikipedia: { Kyoto: { image: "K.jpg" } }, files: { "K.jpg": { license } } });
      expect((await lookupDestinationPhoto("Kyoto"))?.license).toBe(license);
    }
  });

  it("skips disambiguation pages and missing articles", async () => {
    use({ wikipedia: { Springfield: { image: "S.jpg", disambiguation: true } }, files: { "S.jpg": {} } });
    expect(await lookupDestinationPhoto("Springfield")).toBeNull();
    expect(await lookupDestinationPhoto("Nowhere-ville")).toBeNull();
  });

  it("throws WikimediaUnavailable when rate-limited (callers must not cache it)", async () => {
    const fake = use({ wikipedia: { Lisbon: { image: "L.jpg" } }, files: { "L.jpg": {} } });
    fake.failAll(429);
    await expect(lookupDestinationPhotos(["Lisbon"])).rejects.toBeInstanceOf(WikimediaUnavailable);
    expect(await lookupDestinationPhoto("Lisbon")).toBeNull();
  });

  it("falls back to 'Unknown author'", async () => {
    use({ wikipedia: { Lisbon: { image: "L.jpg" } }, files: { "L.jpg": { artist: "" } } });
    expect((await lookupDestinationPhoto("Lisbon"))?.author).toBe("Unknown author");
  });
});

describe("getPlaceResults cache", () => {
  const photo = (place: string): DestinationPhoto => ({
    place,
    subject: place,
    src: "https://x/1.jpg",
    srcSet: "",
    width: 1,
    height: 1,
    author: "A",
    license: "CC0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:1.jpg",
  });
  const found = async (places: string[]) =>
    new Map<string, PlaceResult>(places.map((p) => [p, { photo: photo(p) }]));

  beforeEach(() => resetDestinationPhotoCache());

  it("looks a place up once and gives each caller its own spelling", async () => {
    const lookup = vi.fn(found);
    expect((await getPlaceResults(["lisbon"], lookup)).get("lisbon")?.photo?.place).toBe("lisbon");
    expect((await getPlaceResults([" Lisbon "], lookup)).get("Lisbon")?.photo?.place).toBe("Lisbon");
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("batches the uncached places of one call into one lookup", async () => {
    const lookup = vi.fn(found);
    await getPlaceResults(["A"], lookup);
    await getPlaceResults(["A", "B", "C", "b"], lookup);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(lookup.mock.calls[1]![0]).toEqual(["B", "C"]);
  });

  it("retries misses after 10 minutes", async () => {
    const lookup = vi.fn(async (ps: string[]) => new Map<string, PlaceResult>(ps.map((p) => [p, { photo: null }])));
    await getPlaceResults(["Nowhere"], lookup, 0);
    await getPlaceResults(["Nowhere"], lookup, 9 * 60_000);
    expect(lookup).toHaveBeenCalledTimes(1);
    await getPlaceResults(["Nowhere"], lookup, 11 * 60_000);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("doesn't cache when Wikimedia is unavailable", async () => {
    const lookup = vi.fn(async (): Promise<Map<string, PlaceResult>> => {
      throw new WikimediaUnavailable("429");
    });
    expect((await getPlaceResults(["Lisbon"], lookup)).get("Lisbon")).toEqual({ photo: null });
    await getPlaceResults(["Lisbon"], lookup);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("caps new places per minute, without caching the refusal", async () => {
    const lookup = vi.fn(found);
    const many = Array.from({ length: MAX_COLD_LOOKUPS_PER_MINUTE + 5 }, (_, i) => `place ${i}`);
    const r = await getPlaceResults(many, lookup, 1000);
    expect([...r.values()].filter((x) => x.photo)).toHaveLength(MAX_COLD_LOOKUPS_PER_MINUTE);
    expect((await getPlaceResults(["place 0"], lookup, 2000)).get("place 0")?.photo).not.toBeNull();
    expect((await getPlaceResults([many.at(-1)!], lookup, 62_000)).get(many.at(-1)!)?.photo).not.toBeNull();
  });
});

describe("helpers", () => {
  it("plainText strips tags and entities", () => {
    expect(plainText('<a href="x">Vitor&nbsp;Oliveira</a> from <b>Torres &amp; Vedras</b>')).toBe(
      "Vitor Oliveira from Torres & Vedras",
    );
  });

  it("candidateTitles / placeLabel / photoCacheKey", () => {
    expect(candidateTitles(" Lisbon, Portugal ")).toEqual(["Lisbon, Portugal", "Lisbon"]);
    expect(candidateTitles("Kyoto")).toEqual(["Kyoto"]);
    expect(candidateTitles("  ")).toEqual([]);
    expect(placeLabel("Lisbon, Portugal")).toBe("Lisbon");
    expect(photoCacheKey("  Lisbon ")).toBe("lisbon");
  });

  it("buildSrcSet swaps the thumbnail width and keeps the query", () => {
    const src = "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f2/A_%28b%29.jpg/1920px-A_%28b%29.jpg?utm_source=x";
    const set = buildSrcSet(src).split(", ");
    expect(set).toHaveLength(4);
    expect(set[0]).toBe("https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f2/A_%28b%29.jpg/500px-A_%28b%29.jpg?utm_source=x 500w");
    expect(set[3]).toBe(`${src} 1920w`);
    expect(buildSrcSet("https://upload.wikimedia.org/wikipedia/commons/f/f2/A.jpg")).toBe("");
  });

  it("distanceKm", () => {
    // Lisbon -> Sintra is about 25 km.
    const d = distanceKm({ lat: 38.7223, lon: -9.1393 }, { lat: 38.8029, lon: -9.3817 });
    expect(d).toBeGreaterThan(20);
    expect(d).toBeLessThan(30);
  });
});
