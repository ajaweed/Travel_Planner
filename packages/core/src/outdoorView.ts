// Read-time view of a hike or nature outing: the agent's details plus our own
// checks (Google Places for the trailhead/park, OpenStreetMap for the trail),
// deterministic links, and possible problems against the traveller's
// fitness/access needs. Built on every read, like food.ts.

import { googleMapsSearch, type BookingLink } from "./bookingLinks";
import { OutdoorDraftSchema, type OutdoorDraft } from "./agents/types";
import { outdoorFlags, type OutdoorNeeds } from "./outdoors";
import { restaurantKey, type RestaurantCheck } from "./restaurantChecks";
import { withDestination } from "./researchLinks";
import type { TrailCheck } from "./trailChecks";

export type OutdoorView = OutdoorDraft & {
  /** Google Places check of placeName, when one was made. */
  placeCheck?: RestaurantCheck;
  /** OpenStreetMap check of trailName, when one was made. */
  trailCheck?: TrailCheck;
  /** Possible problems: too hard for the traveller, or numbers that don't fit the rating. */
  flags: string[];
  /** When the mapped trail's length differs a lot from the plan's distance. */
  trailNote?: string;
  /** Google Maps (the verified place, else a search) and the trail's map page. Never model-written. */
  links: BookingLink[];
};

/** Mapped length vs planned distance: only for trails short enough to walk whole (long routes are walked in sections). */
export function trailLengthNote(planKm: number | undefined, trail: TrailCheck | undefined): string | undefined {
  if (!trail || trail.status !== "FOUND" || !trail.lengthKm || !planKm || trail.lengthKm > 30) return undefined;
  if (Math.abs(planKm - trail.lengthKm) / trail.lengthKm <= 0.5) return undefined;
  return `OpenStreetMap maps this trail at ${trail.lengthKm} km; the plan says ${planKm} km. Check which section you'll walk.`;
}

export function outdoorView(
  outdoor: OutdoorDraft,
  city: string | undefined,
  needs: OutdoorNeeds | undefined,
  checks: { places?: Record<string, RestaurantCheck>; trails?: Record<string, TrailCheck> } = {},
): OutdoorView {
  // Stored drafts may predate schema cleanups: re-parse on every read.
  const clean = OutdoorDraftSchema.safeParse(outdoor).data ?? { type: "nature" as const, difficulty: undefined };
  const placeCheck = clean.placeName ? checks.places?.[restaurantKey(clean.placeName)] : undefined;
  const trailCheck = clean.trailName ? checks.trails?.[restaurantKey(clean.trailName)] : undefined;

  const links: BookingLink[] = [];
  if (clean.placeName) {
    const exact = placeCheck && placeCheck.status !== "NOT_FOUND" ? placeCheck.googleMapsUri : undefined;
    links.push(exact ? { provider: "Google Maps", url: exact } : googleMapsSearch(withDestination(clean.placeName, city)));
  }
  if (trailCheck?.status === "FOUND") links.push({ provider: "Trail map", url: trailCheck.url });

  return {
    ...clean,
    placeCheck,
    trailCheck,
    flags: outdoorFlags(clean, needs),
    trailNote: trailLengthNote(clean.distanceKm, trailCheck),
    links,
  };
}
