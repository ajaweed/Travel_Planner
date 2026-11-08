import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getStopPhotos, namedPlaces, resetStopPhotoCache, stopQueries, titleMatches, type Stop } from "./stopPhotos";
import { resetDestinationPhotoCache } from "./destinationPhoto";
import { setWikimediaFetch } from "./wikimedia";
import { fakeWikimedia, type FakeWiki } from "./__fixtures__/fakeWikimedia";

const DUBAI: [number, number] = [25.2048, 55.2708];
const LISBON: [number, number] = [38.7223, -9.1393];

function use(wiki: FakeWiki) {
  const fake = fakeWikimedia({
    ...wiki,
    wikipedia: { Dubai: { coords: DUBAI }, Lisbon: { coords: LISBON }, ...wiki.wikipedia },
  });
  setWikimediaFetch(fake.fn);
  return fake;
}

beforeEach(() => {
  resetStopPhotoCache();
  resetDestinationPhotoCache();
});
afterEach(() => setWikimediaFetch(null));

describe("namedPlaces", () => {
  it.each([
    ["Browse Mercado da Ribeira (Time Out Market) and Feira da Ladra if open", "Lisbon", ["Mercado da Ribeira", "Time Out Market", "Feira da Ladra"]],
    ["Self-guided visit to Castelo de São Jorge viewpoints", "Lisbon", ["Castelo de São Jorge"]],
    ["Burj Khalifa 'At the Top' observation deck", "Dubai", ["Burj Khalifa", "Top"]],
    ["Evening stroll through Alfama's alleys", "Lisbon", ["Alfama"]],
    ["Dubai Fountain show at dusk", "Dubai", ["Dubai Fountain"]],
    ["Relax at Kite Beach or JBR Open Beach", "Dubai", ["JBR Open Beach", "Kite Beach"]],
  ])("%s", (title, city, expected) => {
    expect(namedPlaces(title, city)).toEqual(expected);
  });

  it.each([
    ["Casual dinner at a local tasca", "Lisbon"],
    ["Rest and orient yourself", "Dubai"],
    ["Free walking tour of Lisbon's historic centre", "Lisbon"],
    ["Relax at a miradouro with a drink", "Lisbon"],
    ["Kayaking near the harbour", "Lisbon"],
  ])("names nothing: %s", (title, city) => {
    expect(namedPlaces(title, city)).toEqual([]);
  });
});

describe("stopQueries", () => {
  it("adds the city unless the name already has it, then the whole title as a last resort", () => {
    expect(stopQueries({ id: "1", title: "Dubai Fountain show at dusk", city: "Dubai" })).toEqual([
      "Dubai Fountain",
      "Dubai Fountain show at dusk",
    ]);
    expect(stopQueries({ id: "2", title: "Visit Nishiki Market", city: "Kyoto, Japan" })).toEqual([
      "Nishiki Market Kyoto",
    ]);
  });

  it.each<[string, Partial<Stop>]>([
    ["no city", { title: "Burj Khalifa", city: undefined }],
    ["flights", { title: "Emirates to Dubai", kind: "FLIGHT" }],
    ["hotels", { title: "Stay at Atlantis The Palm", kind: "HOTEL" }],
    ["logistics", { title: "Taxi transfer to Burj Al Arab" }],
    ["unnamed", { title: "Dinner somewhere nice" }],
  ])("skips %s", (_label, s) => {
    expect(stopQueries({ id: "x", title: "", city: "Dubai", ...s } as Stop)).toEqual([]);
  });
});

describe("titleMatches", () => {
  it.each([
    ["Dubai Gold Souk", "Browse the Gold, Spice and Textile Souks", "Dubai"],
    ["São Jorge Castle", "Self-guided visit to Castelo de São Jorge viewpoints", "Lisbon"],
    ["Time Out Market Lisboa", "Browse Mercado da Ribeira (Time Out Market)", "Lisbon"],
    ["Dubai Fountain", "Dubai Fountain show at dusk", "Dubai"],
    ["The Dubai Mall", "Free wander around Dubai Mall and the Waterfall", "Dubai"],
    ["Al Fahidi Historical Neighbourhood", "Walk through the Al Fahidi Historic District", "Dubai"],
  ])("accepts %s for %s", (title, text, city) => {
    expect(titleMatches(title, text, city)).toBe(true);
  });

  it.each([
    ["Luanda", "Relax at a miradouro with a drink", "Lisbon"],
    ["Carnide", "Evening stroll through Alfama's alleys", "Lisbon"],
    ["Lisbon", "Free walking tour of Lisbon's historic centre", "Lisbon"],
    // Only generic words in common:
    ["Dubai Marina Mall", "Browse the Gold Souk market and mall", "Dubai"],
    ["Tourism in Dubai", "Abra ride across Dubai Creek", "Dubai"],
  ])("rejects %s for %s", (title, text, city) => {
    expect(titleMatches(title, text, city)).toBe(false);
  });
});

describe("getStopPhotos", () => {
  const souks: FakeWiki = {
    wikipedia: {
      "Dubai Gold Souk": { image: "Gold.jpg", coords: [25.27, 55.29] },
      "Dubai Spice Souk": { image: "Spice.jpg", coords: [25.26, 55.29] },
      "Gold Souk (Riyadh)": { image: "Riyadh.jpg", coords: [24.6, 46.7] },
    },
    files: { "Gold.jpg": {}, "Spice.jpg": { license: "All rights reserved" }, "Riyadh.jpg": {} },
  };
  const stop: Stop = { id: "s1", title: "Browse the Gold, Spice and Textile Souks", city: "Dubai" };

  it("uses the first verified result and credits what it shows", async () => {
    use({ ...souks, search: { "Gold Dubai": ["Dubai Gold Souk"] } });
    const photo = (await getStopPhotos([stop])).get("s1");
    expect(photo).toMatchObject({ place: stop.title, subject: "Dubai Gold Souk", license: "CC BY-SA 4.0" });
  });

  it("rejects a matching name that's in another city (too far away)", async () => {
    use({ ...souks, search: { "Gold Dubai": ["Gold Souk (Riyadh)"] } });
    expect((await getStopPhotos([stop])).size).toBe(0);
  });

  it("falls through to the next match when the first photo isn't freely licensed", async () => {
    use({ ...souks, search: { "Spice and Textile Souks Dubai": ["Dubai Spice Souk", "Dubai Gold Souk"] } });
    expect((await getStopPhotos([stop])).get("s1")?.subject).toBe("Dubai Gold Souk");
  });

  it("rejects results without coordinates", async () => {
    use({
      wikipedia: { "Dubai Gold Souk": { image: "Gold.jpg" } },
      files: { "Gold.jpg": {} },
      search: { "Gold Dubai": ["Dubai Gold Souk"] },
    });
    expect((await getStopPhotos([stop])).size).toBe(0);
  });

  it("caches results: a second call makes no requests", async () => {
    const fake = use({ ...souks, search: { "Gold Dubai": ["Dubai Gold Souk"] } });
    await getStopPhotos([stop]);
    const before = fake.calls.length;
    expect((await getStopPhotos([{ ...stop, id: "other" }])).get("other")?.subject).toBe("Dubai Gold Souk");
    expect(fake.calls.length).toBe(before);
  });

  it("never throws and doesn't cache when Wikimedia is rate-limiting", async () => {
    const fake = use({ ...souks, search: { "Gold Dubai": ["Dubai Gold Souk"] } });
    fake.failAll(429);
    expect((await getStopPhotos([stop])).size).toBe(0);
    setWikimediaFetch(null);
    const again = use({ ...souks, search: { "Gold Dubai": ["Dubai Gold Souk"] } });
    expect((await getStopPhotos([stop])).get("s1")).toBeDefined();
    expect(again.calls.length).toBeGreaterThan(0);
  });

  it("makes no requests for stops that name nothing", async () => {
    const fake = use({});
    await getStopPhotos([{ id: "x", title: "Casual dinner at a local tasca", city: "Lisbon" }]);
    expect(fake.calls).toHaveLength(0);
  });
});
