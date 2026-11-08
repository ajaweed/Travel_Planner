"use client";

// Destination photos (docs/visual-design.md §3): freely licensed Wikimedia
// Commons images of the actual place, fetched via /api/photos. Every photo
// shown must show its credit too; <PhotoCredit> is not optional.

import { useCallback, useEffect, useRef, useState } from "react";
import type { DestinationPhoto as Photo } from "@trip-planner/core";
// Deep import of a dependency-free module: the package index pulls in
// server-only code (Prisma, the Wikimedia client).
import { photoCacheKey } from "@trip-planner/core/src/placeNames";

export type { Photo };

export type PhotoState =
  | { status: "loading" }
  | {
      status: "ready";
      photo: Photo | null;
      /** Call when the image itself fails to load: drops the photo and its credit. */
      reportBroken: () => void;
    };

// Shared across components so a place is fetched once per page load. Only
// real answers are kept; a failed request is forgotten so a later mount retries.
const clientCache = new Map<string, Promise<Photo | null>>();

// Places requested in the same tick go out as one batched request (the
// landing page's six cards cost one call, and one Wikimedia lookup).
const BATCH_MAX = 12; // matches /api/photos
let queued: Array<{ place: string; resolve: (p: Photo | null) => void }> = [];

function flushQueue() {
  const all = queued;
  queued = [];
  for (let i = 0; i < all.length; i += BATCH_MAX) {
    const batch = all.slice(i, i + BATCH_MAX);
    const qs = batch.map(({ place }) => `place=${encodeURIComponent(place)}`).join("&");
    fetch(`/api/photos?${qs}`)
      .then((r) => {
        if (!r.ok) throw new Error(`photos ${r.status}`);
        return r.json();
      })
      .then((j) => {
        for (const { place, resolve } of batch) resolve((j?.photos?.[place] ?? null) as Photo | null);
      })
      .catch(() => {
        for (const { place, resolve } of batch) {
          clientCache.delete(photoCacheKey(place));
          resolve(null);
        }
      });
  }
}

function fetchPhoto(place: string): Promise<Photo | null> {
  const key = photoCacheKey(place);
  const cached = clientCache.get(key);
  if (cached) return cached;
  const p = new Promise<Photo | null>((resolve) => {
    if (queued.length === 0) setTimeout(flushQueue, 0);
    queued.push({ place: place.trim(), resolve });
  });
  clientCache.set(key, p);
  return p;
}

/** Photos for several places at once, in the given order (for the trip banner). */
export function useDestinationPhotos(places: string[]): PhotoState[] {
  const key = places.map(photoCacheKey).join("|");
  const [photos, setPhotos] = useState<Record<string, Photo | null>>({});
  const [broken, setBroken] = useState<Record<string, true>>({});
  useEffect(() => {
    let cancelled = false;
    setPhotos({});
    for (const place of places) {
      fetchPhoto(place).then((p) => {
        if (!cancelled) setPhotos((cur) => ({ ...cur, [photoCacheKey(place)]: p }));
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the normalised list
  }, [key]);
  return places.map((place) => {
    const k = photoCacheKey(place);
    if (!(k in photos)) return { status: "loading" };
    return {
      status: "ready",
      photo: broken[k] ? null : photos[k]!,
      reportBroken: () => setBroken((b) => ({ ...b, [k]: true })),
    };
  });
}

export function useDestinationPhoto(place: string | undefined): PhotoState {
  const [photo, setPhoto] = useState<Photo | null | undefined>(undefined);
  const reportBroken = useCallback(() => setPhoto(null), []);
  useEffect(() => {
    if (!place?.trim()) {
      setPhoto(null);
      return;
    }
    let cancelled = false;
    setPhoto(undefined);
    fetchPhoto(place).then((p) => {
      if (!cancelled) setPhoto(p);
    });
    return () => {
      cancelled = true;
    };
  }, [place]);
  return photo === undefined ? { status: "loading" } : { status: "ready", photo, reportBroken };
}

/**
 * Fills its (relatively positioned) parent. Fades in on load; shows a warm
 * gradient while loading or when there's no photo, so layouts never jump.
 */
export function PhotoFill({
  state,
  sizes = "100vw",
  className = "",
}: {
  state: PhotoState;
  /** `<img sizes>`: how wide the photo renders, so the browser picks a small file. */
  sizes?: string;
  className?: string;
}) {
  const photo = state.status === "ready" ? state.photo : null;
  return (
    <div aria-hidden="true" className={`absolute inset-0 overflow-hidden bg-gradient-to-br from-sunset-50 via-sand-100 to-lagoon-50 ${className}`}>
      {state.status === "loading" && <div className="absolute inset-0 bg-sand-100 motion-safe:animate-pulse" />}
      {/* Keyed by src so a new photo gets a fresh fade-in state. */}
      {photo && state.status === "ready" && (
        <FadeInImage key={photo.src} photo={photo} sizes={sizes} onBroken={state.reportBroken} />
      )}
    </div>
  );
}

function FadeInImage({ photo, sizes, onBroken }: { photo: Photo; sizes: string; onBroken: () => void }) {
  const ref = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  // A cached image can finish (or fail) before React attaches its handlers;
  // without this check it would stay invisible, or keep a credit for nothing.
  useEffect(() => {
    const el = ref.current;
    if (!el?.complete) return;
    if (el.naturalWidth > 0) setLoaded(true);
    else onBroken();
  }, [onBroken]);
  return (
    // Plain <img>: hotlinked Commons thumbnails, already resized by Wikimedia.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={photo.src}
      srcSet={photo.srcSet || undefined}
      sizes={photo.srcSet ? sizes : undefined}
      alt=""
      width={photo.width}
      height={photo.height}
      decoding="async"
      referrerPolicy="no-referrer"
      onLoad={() => setLoaded(true)}
      onError={onBroken}
      className={`h-full w-full object-cover motion-safe:transition-opacity motion-safe:duration-500 ${loaded ? "opacity-100" : "opacity-0"}`}
    />
  );
}

/** "Photo: Author · CC BY-SA 2.0" linking to the Commons file page (the license's required credit). */
export function PhotoCredit({
  photo,
  label,
  className = "",
}: {
  photo: Photo | null | undefined;
  /** What the photo shows, when the surrounding text doesn't make it obvious. */
  label?: string;
  className?: string;
}) {
  if (!photo) return null;
  return (
    // Only the author may truncate (full name in the tooltip); the license
    // must always be readable.
    <p className={`flex min-w-0 items-baseline gap-1 whitespace-nowrap text-[11px] leading-4 text-ink-500 ${className}`}>
      <span className={label ? "min-w-0 max-w-[45%] truncate" : "shrink-0"}>{label ? `Photo of ${label}:` : "Photo:"}</span>
      <a
        href={photo.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={`${photo.author} (photo of ${photo.subject ?? photo.place}, via Wikimedia Commons)`}
        className="min-w-0 truncate underline decoration-sand-400 underline-offset-2 hover:text-ink-700"
      >
        {photo.author}
      </a>
      <span className="shrink-0">
        {"· "}
        {photo.licenseUrl ? (
          <a href={photo.licenseUrl} target="_blank" rel="noopener noreferrer license" className="underline decoration-sand-400 underline-offset-2 hover:text-ink-700">
            {photo.license}
          </a>
        ) : (
          photo.license
        )}
      </span>
    </p>
  );
}
