import { describe, expect, it } from "vitest";
import { DietarySchema } from "./dietary";
import { activityConflicts, diningView, localFoodView, planFood } from "./food";
import { ItineraryOptionDraftSchema, TripBriefSchema } from "./agents/types";

const halalPeanut = DietarySchema.parse({ requirements: ["halal"], allergies: ["peanuts"] });

describe("diningView", () => {
  it("links the named restaurant in its city", () => {
    const v = diningView({ meal: "lunch", restaurantName: "O Trevo", mustTry: "Bifana" }, "Lisbon, Portugal");
    expect(v.links[0]!.url).toBe("https://www.google.com/maps/search/?api=1&query=O+Trevo%2C+Lisbon");
  });

  it("placeholder names like 'None' are treated as absent, even in old stored drafts", () => {
    const v = diningView({ meal: "breakfast", restaurantName: "None", cuisine: "N/A" }, "Lisbon");
    expect(v.restaurantName).toBeUndefined();
    expect(v.cuisine).toBeUndefined();
    expect(v.links).toEqual([]);
  });
});

describe("activityConflicts", () => {
  it("flags a meal's recommended place and dish", () => {
    expect(
      activityConflicts(
        { title: "Lunch at a tasca", description: "Classic", dining: { meal: "lunch", restaurantName: "O Trevo", mustTry: "Bifana" } },
        halalPeanut,
      ),
    ).toEqual([{ need: "Halal", words: ["bifana"] }]);
  });

  it("flags non-meal stops too (review of a live run: a wine tour in a halal plan)", () => {
    expect(
      activityConflicts({ title: "Lisbon Food & Wine Tasting Walking Tour", bookable: { candidateName: "Taste of Lisboa" } }, halalPeanut),
    ).toEqual([{ need: "Halal", words: ["wine"] }]);
  });

  it("doesn't read the agent's own dietaryNote (which talks about what to avoid)", () => {
    expect(
      activityConflicts(
        { title: "Dinner at Tasca do Chico", dining: { meal: "dinner", dietaryNote: "Grilled fish; skip the chouriço starter." } },
        halalPeanut,
      ),
    ).toEqual([]);
  });
});

describe("localFoodView", () => {
  it("searches a named place, else the dish, in the trip city", () => {
    const named = localFoodView({ name: "Pastel de nata", whereToTry: "Manteigaria" }, undefined, "Lisbon");
    expect(named.links[0]!.url).toContain("query=Manteigaria%2C+Lisbon");
    const generic = localFoodView({ name: "Pastel de nata", whereToTry: "any pastelaria" }, undefined, "Lisbon");
    expect(generic.links[0]!.url).toContain("query=Pastel+de+nata%2C+Lisbon");
  });

  it("flags allergens", () => {
    expect(localFoodView({ name: "Satay", description: "Grilled skewers" }, halalPeanut, "Kuala Lumpur").conflicts).toEqual([
      { need: "Allergy: peanuts", words: ["satay"] },
    ]);
  });
});

describe("planFood", () => {
  const draft = {
    days: [
      {
        dayIndex: 0,
        activities: [
          { title: "Flight" },
          { title: "Dinner in Alfama", dining: { meal: "dinner", restaurantName: "Tasca X" } },
        ],
      },
    ],
    localFoods: [{ name: "Bacalhau à Brás" }, { bogus: true }],
  };
  const saved = [
    {
      dayIndex: 0,
      activities: [
        { id: "a1", order: 0, title: "Flight" },
        { id: "a2", order: 1, title: "Dinner in Alfama" },
      ],
    },
  ];

  it("attaches meals by day and position, lists local foods, and checks every stop", () => {
    const f = planFood(saved, JSON.stringify(draft), undefined, () => "Lisbon", "Lisbon");
    expect([...f.dining.keys()]).toEqual(["a2"]);
    const withWine = [{ dayIndex: 0, activities: [{ id: "w", order: 5, title: "Port wine cellar visit" }] }];
    expect(planFood(withWine, null, halalPeanut, () => "Porto", "Porto").conflicts.get("w")).toEqual([
      { need: "Halal", words: ["wine", "port wine"] },
    ]);
    expect(f.dining.get("a2")?.restaurantName).toBe("Tasca X");
    expect(f.localFoods.map((x) => x.name)).toEqual(["Bacalhau à Brás"]);
  });

  it("never attaches a meal to a different activity (title must match)", () => {
    const edited = [{ dayIndex: 0, activities: [{ id: "a1", order: 0, title: "Flight" }, { id: "a2", order: 1, title: "Museum" }] }];
    expect(planFood(edited, JSON.stringify(draft), undefined, () => "Lisbon", "Lisbon").dining.size).toBe(0);
  });

  it("survives missing or broken drafts", () => {
    expect(planFood(saved, null, undefined, () => undefined, undefined).localFoods).toEqual([]);
    expect(planFood(saved, "{not json", undefined, () => undefined, undefined).dining.size).toBe(0);
  });
});

describe("schemas stay lenient about food", () => {
  const base = { label: "L", summary: "S", pace: "balanced", estimatedTotalCents: 1000 };

  it("a malformed dining block or food entry is dropped, never the whole itinerary", () => {
    const parsed = ItineraryOptionDraftSchema.parse({
      ...base,
      days: [{ dayIndex: 0, activities: [{ title: "Lunch", dining: "lunch somewhere" }] }],
      localFoods: [{ name: "Ok" }, { name: 42 }, "nope"],
    });
    expect(parsed.days[0]!.activities[0]!.dining).toBeUndefined();
    expect(parsed.localFoods).toEqual([{ name: "Ok" }]);
  });

  it("old options without localFoods still parse", () => {
    expect(ItineraryOptionDraftSchema.parse({ ...base, days: [] }).localFoods).toEqual([]);
  });

  it("briefs default to no dietary needs, and junk dietary data doesn't fail the brief", () => {
    const b = { destinations: ["Lisbon"], budgetTotalCents: 100 };
    expect(TripBriefSchema.parse(b).dietary).toEqual({ requirements: [], allergies: [] });
    expect(TripBriefSchema.parse({ ...b, dietary: 42 }).dietary).toEqual({ requirements: [], allergies: [] });
    expect(TripBriefSchema.parse({ ...b, dietary: "halal" }).dietary).toEqual({ requirements: ["halal"], allergies: [], notes: "halal" });
    expect(TripBriefSchema.parse({ ...b, dietary: { requirements: ["Halal"] } }).dietary.requirements).toEqual(["halal"]);
  });
});
