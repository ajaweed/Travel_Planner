import { describe, expect, it } from "vitest";
import {
  DietarySchema,
  dietaryLabels,
  dietConflicts,
  hasDietaryNeeds,
  mergeDietary,
  normalizeDietTag,
  type Dietary,
} from "./dietary";

const diet = (requirements: string[], allergies: string[] = []): Dietary =>
  DietarySchema.parse({ requirements, allergies });
const needs = (text: string, d: Dietary) => dietConflicts(text, d).map((c) => c.need);

describe("normalizeDietTag", () => {
  it.each([
    ["Halal", "halal"],
    ["halal food only", "halal"],
    ["Kosher", "kosher"],
    ["vegan", "vegan"],
    ["Veggie", "vegetarian"],
    ["gluten free", "gluten_free"],
    ["coeliac", "gluten_free"],
    ["lactose intolerant", "dairy_free"],
    ["no pork", "no_pork"],
    ["doesn't drink alcohol", "no_alcohol"],
  ])("%s -> %s", (raw, tag) => {
    expect(normalizeDietTag(raw)).toBe(tag);
  });

  it("drops unknown wording", () => {
    expect(DietarySchema.parse({ requirements: ["paleo", "halal"] }).requirements).toEqual(["halal"]);
  });
});

describe("mergeDietary", () => {
  it("unions tags, allergies and notes", () => {
    const m = mergeDietary(
      { requirements: ["halal"], allergies: ["Peanuts"], notes: "no spicy food" },
      { requirements: ["halal", "gluten_free"], allergies: ["peanuts", "sesame"] },
    );
    expect(m).toEqual({ requirements: ["halal", "gluten_free"], allergies: ["peanuts", "sesame"], notes: "no spicy food" });
  });

  it("handles missing sides", () => {
    expect(mergeDietary(undefined, null)).toEqual({ requirements: [], allergies: [] });
    expect(hasDietaryNeeds(mergeDietary(undefined, null))).toBe(false);
  });

  it("labels", () => {
    expect(dietaryLabels(diet(["kosher"], ["tree nuts"]))).toEqual(["Kosher", "Allergy: tree nuts"]);
  });
});

describe("dietConflicts", () => {
  it.each([
    ["Bifana (pork sandwich) at O Trevo", ["halal"], "Halal"],
    ["Pastel de nata and a slice of presunto", ["halal"], "Halal"],
    ["Tacos al pastor at El Huequito", ["kosher"], "Kosher"],
    ["Seafood rice with clams", ["kosher"], "Kosher"],
    ["Port wine tasting in Gaia", ["halal"], "Halal"],
    ["Sunset cocktails on the rooftop", ["no_alcohol"], "No alcohol"],
    ["Grilled sardines by the river", ["vegetarian"], "Vegetarian"],
    ["Cheese board and honey", ["vegan"], "Vegan"],
    ["Francesinha sandwich", ["gluten_free"], "Gluten-free"],
    ["Ramen at Ichiran", ["gluten_free"], "Gluten-free"],
    ["Steak frites", ["pescatarian"], "Pescatarian"],
    ["Leitão (suckling pig) in Bairrada", ["no_pork"], "No pork"],
  ])("%s conflicts with %s", (text, reqs, need) => {
    expect(needs(text, diet(reqs))).toContain(need);
  });

  it.each([
    ["Satay skewers at the night market", "peanuts"],
    ["Baklava and pistachio ice cream", "tree nuts"],
    ["Hummus and falafel plate", "sesame"],
    ["Garlic prawns", "shellfish"],
    ["Miso soup", "soy"],
    ["Fresh kiwi juice", "kiwi"],
  ])("%s flags allergy %s", (text, allergy) => {
    expect(needs(text, diet([], [allergy]))).toEqual([`Allergy: ${allergy}`]);
  });

  it("accent-insensitive and whole-word", () => {
    expect(needs("Jamon iberico tasting", diet(["halal"]))).toContain("Halal");
    expect(needs("Visit the Hammam", diet(["halal"]))).toEqual([]);
    expect(needs("Ginjinha-free afternoon at the Gingko garden", diet(["no_alcohol"]))).toEqual([]);
  });

  it.each([
    "Certified halal grill, no pork served",
    "A pork-free menu",
    "Everything here is made without any alcohol",
    "Try the chicken version instead of pork",
    "Free of pork",
  ])("ignores negated mentions: %s", (text) => {
    expect(needs(text, diet(["halal"]))).toEqual([]);
  });

  it("negation covers only the word right after it (errs towards flagging)", () => {
    expect(dietConflicts("Free of pork and lard", diet(["halal"]))[0]!.words).toEqual(["lard"]);
  });

  it("still flags a recommendation phrased with a negative idiom", () => {
    expect(needs("No visit to Lisbon is complete without a bifana", diet(["halal"]))).toContain("Halal");
  });

  it("advice to check isn't a recommendation (seen live)", () => {
    expect(
      needs(
        "Sample halal-friendly seafood dishes, asking each stall about pork/alcohol content and peanut handling.",
        diet(["halal"], ["peanuts"]),
      ),
    ).toEqual([]);
    expect(needs("Confirm whether the satay sauce has peanuts", diet([], ["peanuts"]))).toEqual([]);
    // ...but "ask for" still recommends.
    expect(needs("Ask for the bifana", diet(["halal"]))).toContain("Halal");
  });

  it("accented and plain spellings count once", () => {
    expect(dietConflicts("Caldo verde with chouriço", diet(["halal"]))[0]!.words).toEqual(["chouriço"]);
  });

  it("merges words per need", () => {
    const c = dietConflicts("Chorizo and ham croquettes with a glass of wine", diet(["halal"]));
    expect(c).toHaveLength(1);
    expect(c[0]!.words.sort()).toEqual(["chorizo", "ham", "wine"].sort());
  });

  it("no needs, no conflicts", () => {
    expect(dietConflicts("Pork belly", diet([]))).toEqual([]);
    expect(dietConflicts("Pork belly", null)).toEqual([]);
  });
});
