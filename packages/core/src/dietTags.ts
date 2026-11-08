// Diet tag names and labels with no dependencies, safe for client components
// (dietary.ts itself pulls in zod).

export const DIET_TAGS = [
  "halal",
  "kosher",
  "vegetarian",
  "vegan",
  "pescatarian",
  "gluten_free",
  "dairy_free",
  "no_pork",
  "no_alcohol",
] as const;
export type DietTag = (typeof DIET_TAGS)[number];

export const DIET_LABELS: Record<DietTag, string> = {
  halal: "Halal",
  kosher: "Kosher",
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  pescatarian: "Pescatarian",
  gluten_free: "Gluten-free",
  dairy_free: "Dairy-free",
  no_pork: "No pork",
  no_alcohol: "No alcohol",
};
