import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RestaurantPlace } from "@trip-planner/integrations";
import { checkRestaurants, inCity, nameMatches, restaurantKey, MAX_RESTAURANT_CHECKS_PER_GENERATION } from "./restaurantChecks";
import { resetDestinationPhotoCache } from "./destinationPhoto";
import { setWikimediaFetch } from "./wikimedia";
import { diningView } from "./food";

const LISBON = { lat: 38.7223, lon: -9.1393 };

const place = (over: Partial<RestaurantPlace>): RestaurantPlace => ({
  placeId: "p1",
  name: "Taberna do Mercado",
  formattedAddress: "Mercado da Ribeira, Av. 24 de Julho, 1200-479 Lisboa, Portugal",
  location: { lat: 38.707, lon: -9.146 },
  businessStatus: "OPERATIONAL",
  rating: 4.5,
  userRatingsTotal: 1200,
  googleMapsUri: "https://maps.google.com/?cid=123",
  types: ["restaurant", "food"],
  ...over,
});

describe("nameMatches", () => {
  it.each([
    ["Taberna do Mercado", "Taberna do Mercado"],
    ["Zaafran Indian Restaurant", "Zaafran"],
    ["Time Out Market Lisboa", "Time Out Market Lisboa"],
    ["Palácio Chiado", "Palacio Chiado"],
    ["Páteo - Bairro Alto Hotel", "Páteo"],
  ])("%s matches Google's %s", (req, got) => {
    expect(nameMatches(req, got, "Lisbon")).toBe(true);
  });

  it.each([
    ["Taberna do Mercado", "Taberna da Rua das Flores"], // only the generic word in common
    ["Zaafran Indian Restaurant", "Tandoori Nights Indian Restaurant"],
    ["Tasca Kome", "Tasca do Chico"],
    ["Café Central", "Café Nicola"],
  ])("%s does not match Google's %s", (req, got) => {
    expect(nameMatches(req, got, "Lisbon")).toBe(false);
  });
});

describe("inCity", () => {
  it("by distance when coordinates exist", () => {
    expect(inCity(place({}), "Lisbon", LISBON)).toBe(true);
    expect(inCity(place({ location: { lat: 41.15, lon: -8.61 } }), "Lisbon", LISBON)).toBe(false); // Porto
  });

  it("by address otherwise, tolerating local spellings", () => {
    expect(inCity(place({ location: undefined }), "Lisbon, Portugal")).toBe(true);
    expect(inCity(place({ location: undefined, formattedAddress: "Rua X, 4000 Porto, Portugal" }), "Lisbon")).toBe(false);
  });
});

describe("checkRestaurants", () => {
  // City coordinates come from the Wikipedia lookup; give it a fixed answer.
  beforeEach(() => {
    resetDestinationPhotoCache();
    setWikimediaFetch(async (url) => {
      const u = new URL(url);
      const isPages = u.searchParams.get("prop")?.includes("coordinates");
      return {
        ok: true,
        status: 200,
        json: async () =>
          isPages
            ? { query: { pages: [{ title: "Lisbon", coordinates: [{ lat: LISBON.lat, lon: LISBON.lon }] }] } }
            : { query: { pages: [] } },
      };
    });
  });
  afterEach(() => setWikimediaFetch(null));

  const draft = (...names: string[]) => ({
    days: [{ activities: names.map((n) => ({ title: `Dinner at ${n}`, dining: { restaurantName: n } })) }],
  });

  it("verifies a real, open place and records Google's data", async () => {
    const find = vi.fn(async () => ({ ok: true as const, data: [place({})] }));
    const r = await checkRestaurants([draft("Taberna do Mercado")], ["Lisbon"], find);
    expect(r.status).toEqual({ status: "OK", named: 1, checked: 1 });
    expect(r.perOption[0]![restaurantKey("Taberna do Mercado")]).toMatchObject({
      status: "OPEN",
      rating: 4.5,
      userRatingsTotal: 1200,
      googleMapsUri: "https://maps.google.com/?cid=123",
    });
    expect(find).toHaveBeenCalledWith({ name: "Taberna do Mercado", city: "Lisbon", near: LISBON });
  });

  it("Google's nearest guess for a made-up name is NOT a match", async () => {
    const find = async () => ({ ok: true as const, data: [place({ name: "Taberna da Rua das Flores" })] });
    const r = await checkRestaurants([draft("Taberna do Mercado")], ["Lisbon"], find);
    expect(r.perOption[0]![restaurantKey("Taberna do Mercado")]).toEqual({ status: "NOT_FOUND" });
  });

  it("a same-name place in another city is NOT a match", async () => {
    const find = async () => ({ ok: true as const, data: [place({ location: { lat: 41.15, lon: -8.61 } })] });
    const r = await checkRestaurants([draft("Taberna do Mercado")], ["Lisbon"], find);
    expect(r.perOption[0]![restaurantKey("Taberna do Mercado")]).toEqual({ status: "NOT_FOUND" });
  });

  it("reports closures", async () => {
    const find = async () => ({ ok: true as const, data: [place({ businessStatus: "CLOSED_PERMANENTLY" })] });
    const r = await checkRestaurants([draft("Taberna do Mercado")], ["Lisbon"], find);
    expect(r.perOption[0]![restaurantKey("Taberna do Mercado")]?.status).toBe("CLOSED_PERMANENTLY");
  });

  it("checks each name once across options, and caps the total", async () => {
    const find = vi.fn(async () => ({ ok: true as const, data: [place({})] }));
    const many = Array.from({ length: MAX_RESTAURANT_CHECKS_PER_GENERATION + 5 }, (_, i) => `Spot${i} Kitchen`);
    await checkRestaurants([draft("Taberna do Mercado"), draft("taberna do mercado", ...many)], ["Lisbon"], find);
    expect(find).toHaveBeenCalledTimes(MAX_RESTAURANT_CHECKS_PER_GENERATION);
  });

  it("without a key: one probe call, no checks, NOT_CONFIGURED", async () => {
    const find = vi.fn(async () => ({ ok: false as const, reason: "NOT_CONFIGURED" as const, message: "no key" }));
    const r = await checkRestaurants([draft("A Place", "B Place")], ["Lisbon"], find);
    expect(find).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ perOption: [{}], status: { status: "NOT_CONFIGURED" } });
  });

  it("provider errors leave names unchecked (absent), not 'not found'", async () => {
    const find = async () => ({ ok: false as const, reason: "PROVIDER_ERROR" as const, message: "500", retryable: true });
    const r = await checkRestaurants([draft("Taberna do Mercado")], ["Lisbon"], find);
    expect(r.perOption[0]).toEqual({});
    expect(r.status).toEqual({ status: "UNAVAILABLE" });
  });

  it("no named restaurants: no calls", async () => {
    const find = vi.fn();
    const r = await checkRestaurants([{ days: [{ activities: [{ title: "Lunch", dining: {} }] }] }], ["Lisbon"], find);
    expect(find).not.toHaveBeenCalled();
    expect(r.status).toEqual({ status: "NO_CANDIDATES" });
  });
});

describe("diningView with checks", () => {
  it("links to the verified place itself, else a search", () => {
    const checks = { [restaurantKey("Taberna do Mercado")]: { status: "OPEN" as const, name: "Taberna do Mercado", googleMapsUri: "https://maps.google.com/?cid=123" } };
    const v = diningView({ meal: "dinner", restaurantName: "Taberna do Mercado" }, "Lisbon", checks);
    expect(v.check?.status).toBe("OPEN");
    expect(v.links[0]!.url).toBe("https://maps.google.com/?cid=123");
    const nf = diningView({ meal: "dinner", restaurantName: "Made Up" }, "Lisbon", { [restaurantKey("Made Up")]: { status: "NOT_FOUND" } });
    expect(nf.links[0]!.url).toContain("google.com/maps/search");
  });
});
