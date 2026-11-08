// Food UI: dietary badges, the "Local food to try" list, meal details on
// itinerary stops, and the possible-conflict warning. Honesty rules (see
// docs/visual-design.md §4.10):
// - Food suggestions are the AI's; we never present them as verified. When the
//   traveller has dietary needs, we always say to confirm with the restaurant.
// - A possible conflict found by our keyword check is shown, not hidden.

import { AlertTriangle, BadgeCheck, ExternalLink, Info, Salad, SearchX, Star, UtensilsCrossed } from "lucide-react";
import { CARD_CLASSES } from "./ui";

// Type-only import: erased at build, so no server code reaches the client.
import type { DietConflict, DiningView, LocalFoodView, RestaurantCheck } from "@trip-planner/core";

type Link = { provider: string; url: string };
export type { DietConflict };
/** As served by the trip/options routes (links attached, conflicts per stop). */
export type Dining = DiningView;
export type LocalFood = LocalFoodView;

const MEAL_LABELS: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
  drinks: "Drinks",
};

/** "Planned around: Halal · Allergy: peanuts". Renders nothing without needs. */
export function DietaryBadges({ labels, className = "" }: { labels?: string[]; className?: string }) {
  if (!labels?.length) return null;
  return (
    <p className={`flex flex-wrap items-center gap-1.5 text-xs font-medium text-ink-700 ${className}`}>
      <Salad size={14} strokeWidth={1.75} aria-hidden="true" className="text-lagoon-700" />
      <span>Planned around:</span>
      {labels.map((l) => (
        <span key={l} className="rounded-full bg-lagoon-50 px-2 py-0.5 text-lagoon-700">
          {l}
        </span>
      ))}
    </p>
  );
}

/**
 * The standing caveat wherever food is suggested. Restaurants named by the AI
 * can be closed or wrong; with dietary needs, certification and allergens
 * must be confirmed in person.
 */
export function DietaryCaveat({ labels }: { labels?: string[] }) {
  return (
    <p className="flex items-start gap-2 text-xs text-ink-500">
      <Info size={14} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0" />
      <span>
        Food suggestions are AI-generated: check a place is open before you go.
        {labels?.length
          ? " Always confirm halal/kosher certification, ingredients and allergens with the restaurant before you order."
          : ""}
      </span>
    </p>
  );
}

export function ConflictNote({ conflicts, className = "" }: { conflicts?: DietConflict[]; className?: string }) {
  if (!conflicts?.length) return null;
  return (
    <p className={`flex items-start gap-1.5 text-xs font-medium text-warning-700 ${className}`}>
      <AlertTriangle size={14} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0" />
      <span>
        May not suit your diet:{" "}
        {conflicts.map((c, i) => (
          <span key={c.need}>
            {i > 0 && "; "}
            {c.need} (mentions {c.words.join(", ")})
          </span>
        ))}
        . Check before you go.
      </span>
    </p>
  );
}

function MapLinks({ links, subject }: { links?: Link[]; subject: string }) {
  if (!links?.length) return null;
  return (
    <>
      {links.map((l) => (
        <a
          key={l.url}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Find ${subject} on ${l.provider} (opens in a new tab)`}
          className="inline-flex items-center gap-1 rounded text-xs font-medium text-lagoon-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lagoon-600"
        >
          {l.provider}
          <ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />
        </a>
      ))}
    </>
  );
}

/**
 * What Google Places says about a named restaurant. Only real data: a rating
 * shows only when Google has one, and "not found" is worded as "couldn't
 * find", not "doesn't exist".
 */
export function RestaurantCheckLine({ check }: { check?: RestaurantCheck }) {
  if (!check) return null;
  if (check.status === "NOT_FOUND") {
    return (
      <p className="flex items-start gap-1.5 text-xs font-medium text-warning-700">
        <SearchX size={14} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0" />
        We couldn&apos;t find this place on Google. It may not exist or may have moved: check before you go.
      </p>
    );
  }
  if (check.status === "CLOSED_PERMANENTLY" || check.status === "CLOSED_TEMPORARILY") {
    return (
      <p className="flex items-start gap-1.5 text-xs font-medium text-danger-700">
        <AlertTriangle size={14} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0" />
        Google lists {check.name} as {check.status === "CLOSED_PERMANENTLY" ? "permanently" : "temporarily"} closed. Pick
        somewhere else nearby.
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-success-700">
      <BadgeCheck size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
      <span className="font-medium">{check.status === "OPEN" ? "Open, on Google" : "Found on Google"}</span>
      {check.rating !== undefined && (
        <span className="inline-flex items-center gap-1 tabular-nums text-ink-700">
          · <Star size={12} strokeWidth={1.75} aria-hidden="true" className="fill-current text-sunset-600" />
          {check.rating.toFixed(1)}
          {check.userRatingsTotal !== undefined && ` (${check.userRatingsTotal.toLocaleString("en-US")} reviews)`}
        </span>
      )}
    </p>
  );
}

/** Meal details under an itinerary stop's title. */
export function DiningDetail({ dining }: { dining: Dining }) {
  const facts = [MEAL_LABELS[dining.meal] ?? dining.meal, dining.cuisine, dining.priceLevel].filter(Boolean);
  return (
    <div className="mt-1.5 space-y-1 text-sm">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ink-700">
        {dining.restaurantName && <span className="font-medium text-ink-900">{dining.restaurantName}</span>}
        <span className="text-xs text-ink-500">{facts.join(" · ")}</span>
        <MapLinks links={dining.links} subject={dining.restaurantName ?? "this place"} />
      </p>
      <RestaurantCheckLine check={dining.check} />
      {dining.mustTry && (
        <p className="text-ink-700">
          <span className="font-medium">Try:</span> {dining.mustTry}
        </p>
      )}
      {dining.dietaryNote && (
        <p className="flex items-start gap-1.5 text-xs text-ink-700">
          <Salad size={14} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0 text-lagoon-700" />
          {dining.dietaryNote}
        </p>
      )}
    </div>
  );
}

/** The trip's "Local food to try" list. */
export function LocalFoodSection({ foods, dietary }: { foods?: LocalFood[]; dietary?: string[] }) {
  if (!foods?.length) return null;
  return (
    <section aria-labelledby="local-food-heading" className="mt-12">
      <h2 id="local-food-heading" className="flex items-center gap-2 font-display text-2xl font-semibold text-ink-900">
        <UtensilsCrossed size={20} strokeWidth={1.75} aria-hidden="true" className="text-sunset-600" />
        Local food to try
      </h2>
      <DietaryBadges labels={dietary} className="mt-2" />
      <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {foods.map((f, i) => (
          <li key={`${f.name}-${i}`} className={`flex flex-col p-4 ${CARD_CLASSES}`}>
            <h3 className="font-display text-lg font-semibold text-ink-900">{f.name}</h3>
            {f.description && <p className="mt-1 text-sm text-ink-700">{f.description}</p>}
            {f.dietaryNote && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-700">
                <Salad size={14} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0 text-lagoon-700" />
                {f.dietaryNote}
              </p>
            )}
            <ConflictNote conflicts={f.conflicts} className="mt-2" />
            <p className="mt-auto flex flex-wrap items-center gap-x-2 pt-3 text-xs text-ink-500">
              {f.whereToTry && <span>Where: {f.whereToTry}</span>}
              <MapLinks links={f.links} subject={f.name} />
            </p>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <DietaryCaveat labels={dietary} />
      </div>
    </section>
  );
}
