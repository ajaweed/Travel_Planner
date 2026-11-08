import { describe, expect, it } from "vitest";
import { resolveActivityPlaces } from "./activityPlaces";

const booking = (kind: string, params: Record<string, unknown>) => ({ kind, searchParamsJson: JSON.stringify(params) });

describe("resolveActivityPlaces", () => {
  it("single-destination trips: every activity is in that city", () => {
    const r = resolveActivityPlaces([{ activities: [{ id: "a", title: "Casual dinner" }] }], ["Lisbon"]);
    expect(r.get("a")?.city).toBe("Lisbon");
  });

  it("multi-city: a day's hotel sets the city, carried to later days; flights don't count", () => {
    const days = [
      {
        activities: [
          { id: "f", title: "Flight to Lisbon", booking: booking("FLIGHT", { destination: "Lisbon" }) },
          { id: "h", title: "Hotel", booking: booking("HOTEL", { destination: "Porto" }) },
          { id: "d1", title: "Dinner" },
        ],
      },
      { activities: [{ id: "d2", title: "Walk by the river" }] },
      { activities: [{ id: "d3", title: "Day trip to Lisbon" }] },
    ];
    const r = resolveActivityPlaces(days, ["Lisbon", "Porto"]);
    expect(r.get("d1")?.city).toBe("Porto");
    expect(r.get("d2")?.city).toBe("Porto");
    // Naming a destination wins over the carried city.
    expect(r.get("d3")?.city).toBe("Lisbon");
    expect(r.get("h")?.params).toMatchObject({ destination: "Porto" });
  });

  it("unknown city stays unknown", () => {
    const r = resolveActivityPlaces([{ activities: [{ id: "a", title: "Dinner" }] }], ["Lisbon", "Porto"]);
    expect(r.get("a")?.city).toBeUndefined();
  });
});
