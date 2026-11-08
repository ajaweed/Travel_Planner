"use client";

// Destination photos (docs/visual-design.md §3): freely licensed Wikimedia
// Commons images of the actual place, fetched via /api/photos. Every photo
// shown must show its credit too; <PhotoCredit> is not optional.

import { useEffect, useRef, useState } from "react";
import type { DestinationPhoto as Photo } from "@trip-planner/core";

type State = { status: "loading" } | { status: "ready"; photo: Photo | null };

// Shared across components so a place is fetched once per page load.
const clientCache = new Map<string, Promise<Photo | null>>();

function fetchPhoto(place: string): Promise<Photo | null> {
  const key = place.trim().toLowerCase();
  let p = clientCache.get(key);
  if (!p) {
    p = fetch(`/api/photos?place=${encodeURIComponent(place.trim())}`)
      .then((r) => (r.ok ? r.json() : { photo: null }))
      .then((j) => (j?.photo ?? null) as Photo | null)
      .catch(() => null);
    clientCache.set(key, p);
  }
  return p;
}

export function useDestinationPhoto(place: string | undefined): State {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    if (!place?.trim()) {
      setState({ status: "ready", photo: null });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    fetchPhoto(place).then((photo) => {
      if (!cancelled) setState({ status: "ready", photo });
    });
    return () => {
      cancelled = true;
    };
  }, [place]);
  return state;
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
  state: State;
  /** `<img sizes>`: how wide the photo renders, so the browser picks a small file. */
  sizes?: string;
  className?: string;
}) {
  const photo = state.status === "ready" ? state.photo : null;
  return (
    <div aria-hidden="true" className={`absolute inset-0 overflow-hidden bg-gradient-to-br from-sunset-50 via-sand-100 to-lagoon-50 ${className}`}>
      {state.status === "loading" && <div className="absolute inset-0 bg-sand-100 motion-safe:animate-pulse" />}
      {/* Keyed by src so a new photo gets a fresh fade-in state. */}
      {photo && <FadeInImage key={photo.src} photo={photo} sizes={sizes} />}
    </div>
  );
}

function FadeInImage({ photo, sizes }: { photo: Photo; sizes: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  // A cached image can finish loading before React attaches onLoad; without
  // this check it would stay invisible.
  useEffect(() => {
    if (ref.current?.complete && ref.current.naturalWidth > 0) setLoaded(true);
  }, []);
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
