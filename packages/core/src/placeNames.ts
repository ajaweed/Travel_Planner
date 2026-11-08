// Place-name helpers with no dependencies, safe to import from client
// components (the package index pulls in server-only code).

/** Normalised key for caching a place's photo (shared by server and client caches). */
export function photoCacheKey(place: string): string {
  return place.trim().toLowerCase();
}

/** The short name shown on a photo: "Lisbon" for "Lisbon, Portugal". */
export function placeLabel(place: string): string {
  return place.split(",")[0]!.trim() || place.trim();
}
