"use client";

// Destination photos (docs/visual-design.md §3): freely licensed Wikimedia
// Commons images of the actual place, fetched via /api/photos. Every photo
// shown must show its credit too; <PhotoCredit> is not optional.

import { useCallback, useEffect, useRef, useState } from "react";
import type { DestinationPhoto as Photo } from "@trip-planner/core";
// Deep import: the package index pulls in server-only code (Prisma).
import { photoCacheKey } from "@trip-planner/core/src/destinationPhoto";

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

function fetchPhoto(place: string): Promise<Photo | null> {
  const key = photoCacheKey(place);
  const cached = clientCache.get(key);
  if (cached) return cached;
  const p = fetch(`/api/photos?place=${encodeURIComponent(place.trim())}`)
    .then((r) => {
      if (!r.ok) throw new Error(`photos ${r.status}`);
      return r.json();
    })
    .then((j) => (j?.photo ?? null) as Photo | null)
    .catch(() => {
      clientCache.delete(key);
      return null;
    });
  clientCache.set(key, p);
  return p;
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
export function PhotoCredit({ photo, className = "" }: { photo: Photo | null | undefined; className?: string }) {
  if (!photo) return null;
  return (
    // Only the author may truncate (full name in the tooltip); the license
    // must always be readable.
    <p className={`flex min-w-0 items-baseline gap-1 whitespace-nowrap text-[11px] leading-4 text-ink-500 ${className}`}>
      <span className="shrink-0">Photo:</span>
      <a
        href={photo.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={`${photo.author} (photo of ${photo.place}, via Wikimedia Commons)`}
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
