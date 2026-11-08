"use client";

import { MapPin } from "lucide-react";
import { PhotoCredit, PhotoFill, useDestinationPhoto } from "./DestinationPhoto";

const MAX_PLACES = 3;

/**
 * Photos of the trip's destinations under the trip title: one wide photo, or
 * up to three side by side for a multi-city trip. Renders nothing when no
 * destination has a usable photo, so a trip never shows an empty frame.
 */
export function TripPhotoBanner({ destinations }: { destinations: string[] }) {
  const places = destinations.slice(0, MAX_PLACES);
  // Fixed-length hook calls: places is at most MAX_PLACES, padded with undefined.
  const s0 = useDestinationPhoto(places[0]);
  const s1 = useDestinationPhoto(places[1]);
  const s2 = useDestinationPhoto(places[2]);
  const states = [s0, s1, s2].slice(0, places.length);

  if (places.length === 0) return null;
  const allMissing = states.every((s) => s.status === "ready" && !s.photo);
  if (allMissing) return null;

  // Multi-city: only places that have a photo get a tile (once known).
  const tiles = places
    .map((place, i) => ({ place, state: states[i]! }))
    .filter(({ state }) => state.status === "loading" || state.photo);

  return (
    <figure className="mt-6">
      <div
        className={`grid gap-3 ${tiles.length === 2 ? "sm:grid-cols-2" : tiles.length >= 3 ? "sm:grid-cols-3" : ""}`}
      >
        {tiles.map(({ place, state }) => (
          <div
            key={place}
            className={`relative overflow-hidden rounded-3xl shadow-lift ${tiles.length === 1 ? "h-56 md:h-80" : "h-48 md:h-64"}`}
          >
            <PhotoFill state={state} sizes={tiles.length === 1 ? "(min-width: 1024px) 960px, 100vw" : "(min-width: 640px) 33vw, 100vw"} />
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-ink-900/70 to-transparent" />
            <span className="absolute bottom-4 left-4 inline-flex items-center gap-1.5 font-display text-xl font-semibold text-white [text-shadow:0_1px_8px_rgba(31,42,51,0.6)] md:text-2xl">
              <MapPin size={18} strokeWidth={2} aria-hidden="true" />
              {place.split(",")[0]}
            </span>
          </div>
        ))}
      </div>
      <figcaption className="mt-2 space-y-0.5">
        {tiles.map(({ place, state }) => (
          <PhotoCredit key={place} photo={state.status === "ready" ? state.photo : null} />
        ))}
      </figcaption>
    </figure>
  );
}
