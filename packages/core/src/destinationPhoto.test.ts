import { describe, expect, it } from "vitest";
import { buildSrcSet, candidateTitles, lookupDestinationPhoto, plainText } from "./destinationPhoto";

type PageImages = Record<string, { pageimage?: string; missing?: boolean; disambiguation?: boolean }>;
type Files = Record<string, { mime?: string; repo?: string; license?: string; nonFree?: boolean; artist?: string }>;

function fakeFetch(pages: PageImages, files: Files) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    const title = new URL(url).searchParams.get("titles")!;
    if (title.startsWith("File:")) {
      const f = files[title.slice(5)];
      const page = f
        ? {
            imagerepository: f.repo ?? "shared",
            imageinfo: [
              {
                mime: f.mime ?? "image/jpeg",
                thumburl: `https://upload.wikimedia.org/thumb/${title.slice(5)}`,
                thumbwidth: 1600,
                thumbheight: 1000,
                descriptionurl: `https://commons.wikimedia.org/wiki/${title}`,
                extmetadata: {
                  Artist: { value: f.artist ?? '<a href="https://x">Ana Silva</a>' },
                  LicenseShortName: { value: f.license ?? "CC BY-SA 4.0" },
                  LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
                  ...(f.nonFree ? { NonFree: { value: "true" } } : {}),
                },
              },
            ],
          }
        : { missing: true };
      return { ok: true, json: async () => ({ query: { pages: [page] } }) };
    }
    const p = pages[title];
    const page = p
      ? { title, pageimage: p.pageimage, missing: p.missing, pageprops: p.disambiguation ? { disambiguation: "" } : {} }
      : { title, missing: true };
    return { ok: true, json: async () => ({ query: { pages: [page] } }) };
  };
  return { fn, calls };
}

describe("lookupDestinationPhoto", () => {
  it("returns a credited photo for a freely licensed lead image", async () => {
    const { fn } = fakeFetch({ Lisbon: { pageimage: "Lisboa_view.jpg" } }, { "Lisboa_view.jpg": {} });
    const photo = await lookupDestinationPhoto("Lisbon", fn);
    expect(photo).toMatchObject({
      place: "Lisbon",
      author: "Ana Silva",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Lisboa_view.jpg",
    });
  });

  it("falls back from 'City, Country' to the city name", async () => {
    const { fn, calls } = fakeFetch({ Lisbon: { pageimage: "Lisboa_view.jpg" } }, { "Lisboa_view.jpg": {} });
    expect(await lookupDestinationPhoto("Lisbon, Portugal", fn)).not.toBeNull();
    // "Lisbon, Portugal" on Wikipedia, then Wikivoyage; "Lisbon" on Wikipedia + its file.
    expect(calls).toHaveLength(4);
  });

  it("falls back to Wikivoyage when Wikipedia's lead image is unusable", async () => {
    const wp = fakeFetch({ Dubai: { pageimage: "Tower.jpg" } }, { "Tower.jpg": { repo: "local" } });
    const wv = fakeFetch({ Dubai: { pageimage: "Creek.jpg" } }, { "Creek.jpg": {} });
    const fn = (url: string) => (url.includes("wikivoyage") ? wv.fn(url) : wp.fn(url));
    const photo = await lookupDestinationPhoto("Dubai", fn);
    expect(photo?.sourceUrl).toBe("https://commons.wikimedia.org/wiki/File:Creek.jpg");
  });

  it.each([
    ["a flag", "Flag_of_Portugal.jpg", {}],
    ["a map", "Patagonia_map.jpg", {}],
    ["an SVG", "Skyline.svg", { mime: "image/svg+xml" }],
    ["a PNG diagram", "Skyline.png", { mime: "image/png" }],
    ["a non-free file", "Poster.jpg", { license: "Fair use", repo: "local" }],
    ["a NonFree-flagged file", "Poster.jpg", { nonFree: true }],
    ["an all-rights-reserved file", "Poster.jpg", { license: "All rights reserved" }],
  ])("rejects %s", async (_label, name, file) => {
    const { fn } = fakeFetch({ Place: { pageimage: name } }, { [name]: file });
    expect(await lookupDestinationPhoto("Place", fn)).toBeNull();
  });

  it("accepts public domain and CC0", async () => {
    for (const license of ["Public domain", "CC0"]) {
      const { fn } = fakeFetch({ Kyoto: { pageimage: "K.jpg" } }, { "K.jpg": { license } });
      expect((await lookupDestinationPhoto("Kyoto", fn))?.license).toBe(license);
    }
  });

  it("skips disambiguation pages and missing articles", async () => {
    const { fn } = fakeFetch({ Springfield: { pageimage: "S.jpg", disambiguation: true } }, { "S.jpg": {} });
    expect(await lookupDestinationPhoto("Springfield", fn)).toBeNull();
    expect(await lookupDestinationPhoto("Nowhere-ville", fn)).toBeNull();
  });

  it("never throws: network errors and bad JSON give null", async () => {
    expect(await lookupDestinationPhoto("Lisbon", async () => { throw new Error("offline"); })).toBeNull();
    expect(await lookupDestinationPhoto("Lisbon", async () => ({ ok: true, json: async () => null }))).toBeNull();
    expect(await lookupDestinationPhoto("Lisbon", async () => ({ ok: false, json: async () => ({}) }))).toBeNull();
  });

  it("falls back to 'Unknown author' when Commons has none", async () => {
    const { fn } = fakeFetch({ Lisbon: { pageimage: "L.jpg" } }, { "L.jpg": { artist: "" } });
    expect((await lookupDestinationPhoto("Lisbon", fn))?.author).toBe("Unknown author");
  });
});

describe("helpers", () => {
  it("plainText strips tags and entities", () => {
    expect(plainText('<a href="x">Vitor&nbsp;Oliveira</a> from <b>Torres &amp; Vedras</b>')).toBe(
      "Vitor Oliveira from Torres & Vedras",
    );
  });

  it("candidateTitles", () => {
    expect(candidateTitles(" Lisbon, Portugal ")).toEqual(["Lisbon, Portugal", "Lisbon"]);
    expect(candidateTitles("Kyoto")).toEqual(["Kyoto"]);
    expect(candidateTitles("  ")).toEqual([]);
  });

  it("buildSrcSet swaps the thumbnail width and keeps the query", () => {
    const src = "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f2/A_%28b%29.jpg/1920px-A_%28b%29.jpg?utm_source=x";
    const set = buildSrcSet(src).split(", ");
    expect(set).toHaveLength(4);
    expect(set[0]).toBe("https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f2/A_%28b%29.jpg/500px-A_%28b%29.jpg?utm_source=x 500w");
    expect(set[3]).toBe(`${src} 1920w`);
  });

  it("buildSrcSet gives up on URLs that aren't thumbnails", () => {
    expect(buildSrcSet("https://upload.wikimedia.org/wikipedia/commons/f/f2/A.jpg")).toBe("");
  });
});
