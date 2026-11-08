"use client";

import { MapPin } from "lucide-react";
import { photoCacheKey, placeLabel } from "@trip-planner/core/src/placeNames";
import { PhotoCredit, PhotoFill, useDestinationPhotos } from "./DestinationPhoto";

/**
 * Photos of every destination in the trip, under the trip title: one wide
 * photo, two or three side by side, and a grid for longer multi-city trips.
 * Places without a usable photo are left out once known; renders nothing if
 * none has one, so a trip never shows an empty frame.
 */
export function TripPhotoBanner({ destinations }: { destinations: string[] }) {
  // De-duplicated by the name on the tile: a round trip can list its first
  // city again at the end, spelled differently ("Lisbon, Portugal" / "Lisbon").
  const seen = new Set<string>();
  const places = destinations.filter((d) => {
    const key = photoCacheKey(placeLabel(d));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const states = useDestinationPhotos(places);

  // ...and by photo, in case two names resolve to the same article.
  const shown = new Set<string>();
  const tiles = places
    .map((place, i) => ({ place, state: states[i]! }))
    .filter(({ state }) => {
      if (state.status === "loading") return true;
      if (!state.photo || shown.has(state.photo.src)) return false;
      shown.add(state.photo.src);
      return true;
    });
  if (tiles.length === 0) return null;

  const n = tiles.length;
  const grid = n === 1 ? "" : n === 2 || n === 4 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3";
  const height = n === 1 ? "h-56 md:h-80" : n <= 3 ? "h-48 md:h-64" : "h-40 md:h-48";
  const sizes = n === 1 ? "(min-width: 1024px) 960px, 100vw" : "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw";

  return (
    <figure className="mt-6">
      <div className={`grid gap-3 ${grid}`}>
        {tiles.map(({ place, state }) => (
          <div key={place} className={`relative overflow-hidden rounded-3xl shadow-lift ${height}`}>
            <PhotoFill state={state} sizes={sizes} />
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-ink-900/70 to-transparent" />
            <span className="absolute bottom-4 left-4 inline-flex items-center gap-1.5 font-display text-xl font-semibold text-white [text-shadow:0_1px_8px_rgba(31,42,51,0.6)] md:text-2xl">
              <MapPin size={18} strokeWidth={2} aria-hidden="true" />
              {placeLabel(place)}
            </span>
          </div>
        ))}
      </div>
      <figcaption className="mt-2 space-y-0.5">
        {tiles.map(({ place, state }) => (
          <PhotoCredit key={place} photo={state.status === "ready" ? state.photo : null} label={n > 1 ? placeLabel(place) : undefined} />
        ))}
      </figcaption>
    </figure>
  );
}
