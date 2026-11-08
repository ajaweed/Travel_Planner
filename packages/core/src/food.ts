// Read-time view of the food in a plan: meals (dining activities) and the
// "Local food to try" list, each with deterministic links and possible
// dietary conflicts. Built from the stored option draft, so it applies to
// existing plans without a migration and improves when the checks do.

import { googleMapsSearch, type BookingLink } from "./bookingLinks";
import { withDestination } from "./researchLinks";
import { foodCity } from "./activityPlaces";
import { restaurantKey, type RestaurantCheck } from "./restaurantChecks";
import { type DietConflict, type Dietary, dietConflicts } from "./dietary";
import { DiningDraftSchema, LocalFoodSchema, type DiningDraft, type LocalFood } from "./agents/types";

export type DiningView = DiningDraft & {
  /** Google Maps link: the verified place itself, else a search for the name (never model-written). */
  links: BookingLink[];
  /** Google Places check of the named restaurant, when one was made. */
  check?: RestaurantCheck;
};

export type LocalFoodView = LocalFood & { conflicts: DietConflict[]; links: BookingLink[] };

/**
 * A meal as shown. Possible dietary conflicts are per stop, not per meal:
 * see `activityConflicts`.
 */
export function diningView(
  dining: DiningDraft,
  city: string | undefined,
  checks?: Record<string, RestaurantCheck>,
): DiningView {
  // Stored drafts predate some cleanup (e.g. a restaurant called "None"), so
  // re-run them through the schema on every read.
  const clean = DiningDraftSchema.safeParse(dining).data ?? { meal: "lunch" as const };
  if (!clean.restaurantName) return { ...clean, links: [] };
  const check = checks?.[restaurantKey(clean.restaurantName)];
  const exact = check && check.status !== "NOT_FOUND" ? check.googleMapsUri : undefined;
  return {
    ...clean,
    check,
    links: [exact ? { provider: "Google Maps", url: exact } : googleMapsSearch(withDestination(clean.restaurantName, city))],
  };
}

/** A "Local food to try" entry as shown. Links search for the dish (or named place) in the city. */
export function localFoodView(food: LocalFood, dietary: Dietary | undefined, city: string | undefined): LocalFoodView {
  food = LocalFoodSchema.safeParse(food).data ?? { name: String(food.name) };
  const text = [food.name, food.description].filter(Boolean).join(". ");
  const where = food.whereToTry?.trim();
  // A generic "any pastelaria" isn't a place; search the dish instead.
  const namedPlace = where && /^\p{Lu}/u.test(where) && !/^(any|most|a|an|the)\b/i.test(where) ? where : undefined;
  return {
    ...food,
    conflicts: dietConflicts(text, dietary),
    links: [googleMapsSearch(withDestination(namedPlace ?? food.name, city))],
  };
}

type SavedDay = {
  dayIndex: number;
  activities: Array<{
    id: string;
    order: number;
    title: string;
    description?: string | null;
    /** The named hotel/tour, if any (for the conflict check). */
    candidateName?: string;
  }>;
};
type StoredDraftLike = {
  restaurantChecks?: Record<string, RestaurantCheck>;
  days?: Array<{ dayIndex: number; activities?: Array<{ title?: string; dining?: DiningDraft }> }>;
  localFoods?: LocalFood[];
};

export type PlanFood = {
  dining: Map<string, DiningView>;
  /** Possible dietary conflicts per saved activity id (any stop, not just meals). */
  conflicts: Map<string, DietConflict[]>;
  localFoods: LocalFoodView[];
};

/**
 * Food for a chosen plan. Activities were saved from the selected option's
 * draft in order (selectItineraryOption -> materializeItinerary), so a saved
 * activity's (dayIndex, order) points at its draft activity. The title must
 * match too, so a plan edited later can never get the wrong meal attached.
 */
export function planFood(
  savedDays: SavedDay[],
  selectedDraftJson: string | null | undefined,
  dietary: Dietary | undefined,
  cityFor: (activityId: string) => string | undefined,
  destinations: string[],
): PlanFood {
  let draft: StoredDraftLike = {};
  try {
    if (selectedDraftJson) draft = JSON.parse(selectedDraftJson) as StoredDraftLike;
  } catch {
    draft = {};
  }

  const dining = new Map<string, DiningView>();
  const conflicts = new Map<string, DietConflict[]>();
  for (const day of savedDays) {
    const draftDay = draft.days?.find((d) => d.dayIndex === day.dayIndex);
    for (const a of day.activities) {
      const d = draftDay?.activities?.[a.order];
      const meal = d?.dining && d.title === a.title ? d.dining : undefined;
      if (meal) dining.set(a.id, diningView(meal, cityFor(a.id), draft.restaurantChecks));
      const c = activityConflicts({ ...a, bookable: { candidateName: a.candidateName }, dining: meal }, dietary);
      if (c.length) conflicts.set(a.id, c);
    }
  }
  const localFoods = (Array.isArray(draft.localFoods) ? draft.localFoods : [])
    .filter((f) => f && typeof f.name === "string")
    .map((f) => localFoodView(f, dietary, foodCity(f, destinations)));
  return { dining, conflicts, localFoods };
}

/**
 * Possible conflicts for ANY itinerary stop, not just meals: the agent can
 * slip a "Food & Wine Tasting Walking Tour" into a halal traveller's plan.
 * Reads the stop's title and description, the named place, and (for meals)
 * the recommended place/cuisine/dish -- never the agent's own dietaryNote.
 */
export function activityConflicts(
  activity: { title: string; description?: string | null; bookable?: { candidateName?: string } | null; dining?: DiningDraft | null },
  dietary: Dietary | undefined,
): DietConflict[] {
  const d = activity.dining;
  const text = [
    activity.title,
    activity.description,
    activity.bookable?.candidateName,
    d?.restaurantName,
    d?.cuisine,
    d?.mustTry,
  ]
    .filter(Boolean)
    .join(". ");
  return dietConflicts(text, dietary);
}
