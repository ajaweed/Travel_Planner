// Destination photos: the lead image of the place's Wikipedia article (else
// Wikivoyage's), used only when the file is freely licensed on Wikimedia
// Commons. Every photo carries its credit (author, license, source page) and
// the UI must show it. See docs/visual-design.md §3.
//
// Why Wikipedia's lead image: editors chose it to represent *that* place, so a
// Lisbon trip shows Lisbon, not a stock beach. Lookups are batched (one
// request covers up to 50 places) and go through ./wikimedia's shared limiter.

import { photoCacheKey, placeLabel } from "./placeNames";
import { WIKIPEDIA_API, WIKIVOYAGE_API, WikimediaUnavailable, wikiQuery } from "./wikimedia";

export type DestinationPhoto = {
  /** The place we looked up, as the caller spelled it. */
  place: string;
  /** What the photo actually shows (the article title), e.g. "Dubai Gold Souk". */
  subject: string;
  /** Resized image URL on Wikimedia's thumbnail server. */
  src: string;
  /** Smaller renditions for `<img srcSet>`; may be empty. */
  srcSet: string;
  width: number;
  height: number;
  /** Plain-text author, HTML stripped. "Unknown author" if Commons has none. */
  author: string;
  /** e.g. "CC BY-SA 2.0", "Public domain". */
  license: string;
  licenseUrl?: string;
  /** The Commons file page (the credit links here). */
  sourceUrl: string;
};

export type Coords = { lat: number; lon: number };

const WIDTH = 1920;
// Wikimedia's standard thumbnail steps.
const SRCSET_WIDTHS = [500, 960, 1280, 1920];
const BATCH = 50; // titles per Action API request
// Lead images are sometimes a flag, map, logo or locator diagram. We only want photographs.
const NOT_A_PHOTO = /\b(flag|map|coat[ _]of[ _]arms|locator|location|logo|seal|emblem|montage|collage|diagram|svg)\b/i;
const PHOTO_MIME = new Set(["image/jpeg", "image/webp"]);
// Free licenses only. NonCommercial / NoDerivatives variants aren't free.
const FREE_LICENSE = /^(cc[ -]?(by|zero|0)|cc0|public domain|pd\b|attribution)/i;
const RESTRICTED_LICENSE = /\b(nc|nd)\b/i;

// ---------------------------------------------------------------- helpers

/** Strips tags and entities from Commons' HTML metadata to plain text. */
export function plainText(html: string | undefined): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export { photoCacheKey, placeLabel };

/** Titles to try, most specific first: "Lisbon, Portugal" then "Lisbon". */
export function candidateTitles(place: string): string[] {
  const full = place.trim();
  if (!full) return [];
  const head = placeLabel(full);
  return head && head !== full ? [full, head] : [full];
}

/** True for file names that look like photographs (not flags, maps, logos...). */
export function looksLikePhoto(fileName: string): boolean {
  return !NOT_A_PHOTO.test(fileName.replace(/_/g, " "));
}

/**
 * Thumbnail URLs carry their width as ".../1920px-Name.jpg"; swapping it gives
 * the other standard sizes. Returns "" if the URL doesn't have that shape.
 */
export function buildSrcSet(src: string): string {
  if (!/\/\d+px-[^/]+$/.test(src.split("?")[0]!)) return "";
  return SRCSET_WIDTHS.map((w) => `${src.replace(/\/\d+px-([^/?]+)(\?|$)/, `/${w}px-$1$2`)} ${w}w`).join(", ");
}

/** Great-circle distance in km. */
export function distanceKm(a: Coords, b: Coords): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

// ------------------------------------------------------------ API batches

export type PageInfo = {
  title: string;
  image?: string;
  coords?: Coords;
  disambiguation: boolean;
};

function readPage(p: any): PageInfo | null {
  if (!p || p.missing || p.invalid || typeof p.title !== "string") return null;
  const c = p.coordinates?.[0];
  return {
    title: p.title,
    image: typeof p.pageimage === "string" ? p.pageimage : undefined,
    coords: c && Number.isFinite(c.lat) && Number.isFinite(c.lon) ? { lat: c.lat, lon: c.lon } : undefined,
    disambiguation: p.pageprops?.disambiguation !== undefined,
  };
}

/** Page info for many titles, keyed by the title as requested (following normalisation and redirects). */
export async function pageInfo(api: string, titles: string[], signal?: AbortSignal): Promise<Map<string, PageInfo>> {
  const out = new Map<string, PageInfo>();
  for (const batch of chunks([...new Set(titles)], BATCH)) {
    const json = await wikiQuery(
      api,
      { redirects: "1", prop: "pageimages|pageprops|coordinates", piprop: "name", titles: batch.join("|") },
      signal,
    );
    const q = json?.query ?? {};
    const hop = new Map<string, string>();
    for (const n of q.normalized ?? []) hop.set(n.from, n.to);
    for (const r of q.redirects ?? []) hop.set(r.from, r.to);
    const pages = new Map<string, PageInfo>();
    for (const p of q.pages ?? []) {
      const info = readPage(p);
      if (info) pages.set(info.title, info);
    }
    for (const t of batch) {
      let cur = t;
      for (let i = 0; i < 5 && hop.has(cur); i++) cur = hop.get(cur)!;
      const info = pages.get(cur);
      if (info) out.set(t, info);
    }
  }
  return out;
}

export type Credit = Omit<DestinationPhoto, "place" | "subject">;

function readImageInfo(page: any): Credit | null {
  const info = page?.imageinfo?.[0];
  // "shared" = hosted on Commons. Files local to a wiki are often non-free, or
  // kept off Commons for a copyright reason (e.g. no freedom of panorama).
  if (!info || page.imagerepository !== "shared" || !PHOTO_MIME.has(info.mime)) return null;
  const meta = info.extmetadata ?? {};
  const license = plainText(meta.LicenseShortName?.value);
  if (meta.NonFree?.value === "true" || !FREE_LICENSE.test(license) || RESTRICTED_LICENSE.test(license)) return null;
  const src: unknown = info.thumburl ?? info.url;
  const sourceUrl: unknown = info.descriptionurl;
  if (typeof src !== "string" || typeof sourceUrl !== "string") return null;
  if (!src.startsWith("https://") || !sourceUrl.startsWith("https://commons.wikimedia.org/")) return null;
  const licenseUrl = plainText(meta.LicenseUrl?.value);
  return {
    src,
    srcSet: buildSrcSet(src),
    width: Number(info.thumbwidth) || WIDTH,
    height: Number(info.thumbheight) || Math.round(WIDTH * 0.66),
    author: plainText(meta.Artist?.value).slice(0, 120) || "Unknown author",
    license,
    licenseUrl: licenseUrl.startsWith("https://") ? licenseUrl : undefined,
    sourceUrl,
  };
}

/** Licensed photo details for many files (names without "File:"), keyed by name as given. Unusable files are absent. */
export async function fileCredits(api: string, files: string[], signal?: AbortSignal): Promise<Map<string, Credit>> {
  const out = new Map<string, Credit>();
  for (const batch of chunks([...new Set(files)].filter(looksLikePhoto), BATCH)) {
    const json = await wikiQuery(
      api,
      {
        prop: "imageinfo",
        iiprop: "url|mime|extmetadata",
        iiurlwidth: String(WIDTH),
        iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|NonFree",
        titles: batch.map((f) => `File:${f}`).join("|"),
      },
      signal,
    );
    const q = json?.query ?? {};
    const norm = new Map<string, string>();
    for (const n of q.normalized ?? []) norm.set(n.from, n.to);
    const pages = new Map<string, any>();
    for (const p of q.pages ?? []) if (typeof p?.title === "string") pages.set(p.title, p);
    for (const f of batch) {
      const key = `File:${f}`;
      const credit = readImageInfo(pages.get(norm.get(key) ?? key));
      if (credit) out.set(f, credit);
    }
  }
  return out;
}

// --------------------------------------------------------- destinations

export type PlaceResult = { photo: DestinationPhoto | null; coords?: Coords };

/**
 * Photos (and coordinates) for many places in a few batched requests:
 * Wikipedia first, Wikivoyage for whatever's left. Throws
 * WikimediaUnavailable if Wikimedia can't be reached -- callers must not
 * cache that as "no photo".
 */
export async function lookupDestinationPhotos(places: string[], signal?: AbortSignal): Promise<Map<string, PlaceResult>> {
  const results = new Map<string, PlaceResult>(places.map((p) => [p, { photo: null }]));
  for (const api of [WIKIPEDIA_API, WIKIVOYAGE_API]) {
    const pending = places.filter((p) => !results.get(p)!.photo);
    if (pending.length === 0) break;
    const infos = await pageInfo(api, pending.flatMap(candidateTitles), signal);

    const chosen = new Map<string, PageInfo>();
    for (const place of pending) {
      const pagesForPlace = candidateTitles(place)
        .map((t) => infos.get(t))
        .filter((i): i is PageInfo => !!i && !i.disambiguation);
      // Coordinates come from Wikipedia's best article even when it has no usable photo.
      const result = results.get(place)!;
      if (!result.coords) result.coords = pagesForPlace.find((i) => i.coords)?.coords;
      const withPhoto = pagesForPlace.find((i) => i.image && looksLikePhoto(i.image));
      if (withPhoto) chosen.set(place, withPhoto);
    }

    const credits = await fileCredits(api, [...chosen.values()].map((i) => i.image!), signal);
    for (const [place, info] of chosen) {
      const credit = credits.get(info.image!);
      if (credit) results.get(place)!.photo = { place, subject: info.title, ...credit };
    }
  }
  return results;
}

/** Single-place convenience; null on any failure. */
export async function lookupDestinationPhoto(place: string): Promise<DestinationPhoto | null> {
  try {
    return (await lookupDestinationPhotos([place.trim()])).get(place.trim())?.photo ?? null;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------- cache

const HIT_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 10 * 60 * 1000; // a miss may be a fresh article or a fixed license
const MAX_ENTRIES = 1000;
// The photos endpoint is public: cap how many *new* places can be looked up
// per minute so a script feeding it random names can't spend the shared
// Wikimedia budget that real trips need.
export const MAX_COLD_LOOKUPS_PER_MINUTE = 60;

type Entry = { expires: number; value: PlaceResult };
type Cache = { entries: Map<string, Entry>; cold: { start: number; count: number } };
const gc = globalThis as unknown as { __tripPlannerPlaceCache?: Cache };
function cache(): Cache {
  return (gc.__tripPlannerPlaceCache ??= { entries: new Map(), cold: { start: 0, count: 0 } });
}

/** Test-only: clears the place cache and the cold-lookup window. */
export function resetDestinationPhotoCache(): void {
  gc.__tripPlannerPlaceCache = undefined;
}

/**
 * Cached `lookupDestinationPhotos`: 24h for hits, 10min for misses, nothing
 * cached when Wikimedia was unavailable or the cold-lookup cap was hit (those
 * places come back as { photo: null } and get a real lookup next time).
 * Each photo carries the caller's own spelling of the place.
 */
export async function getPlaceResults(
  places: string[],
  lookup: (places: string[]) => Promise<Map<string, PlaceResult>> = lookupDestinationPhotos,
  now: number = Date.now(),
): Promise<Map<string, PlaceResult>> {
  const c = cache();
  const out = new Map<string, PlaceResult>();
  const toFetch: string[] = [];
  for (const raw of places) {
    const place = raw.trim();
    if (!place || out.has(place)) continue;
    const hit = c.entries.get(photoCacheKey(place));
    if (hit && now < hit.expires) {
      out.set(place, { ...hit.value, photo: hit.value.photo && { ...hit.value.photo, place } });
    } else {
      out.set(place, { photo: null });
      if (!toFetch.some((p) => photoCacheKey(p) === photoCacheKey(place))) toFetch.push(place);
    }
  }

  if (now - c.cold.start >= 60_000) c.cold = { start: now, count: 0 };
  const allowed = toFetch.slice(0, Math.max(0, MAX_COLD_LOOKUPS_PER_MINUTE - c.cold.count));
  c.cold.count += allowed.length;
  if (allowed.length === 0) return out;

  let fetched: Map<string, PlaceResult>;
  try {
    fetched = await lookup(allowed);
  } catch (err) {
    if (err instanceof WikimediaUnavailable) return out;
    throw err;
  }
  for (const place of allowed) {
    const value = fetched.get(place) ?? { photo: null };
    if (c.entries.size >= MAX_ENTRIES) c.entries.delete(c.entries.keys().next().value!);
    c.entries.set(photoCacheKey(place), { expires: now + (value.photo ? HIT_TTL_MS : MISS_TTL_MS), value });
  }
  for (const place of out.keys()) {
    const key = photoCacheKey(place);
    const match = allowed.find((p) => photoCacheKey(p) === key);
    if (!match) continue;
    const value = fetched.get(match) ?? { photo: null };
    out.set(place, { ...value, photo: value.photo && { ...value.photo, place } });
  }
  return out;
}

/** Photos for many places (cached). */
export async function getDestinationPhotos(places: string[]): Promise<Map<string, DestinationPhoto | null>> {
  const results = await getPlaceResults(places);
  return new Map([...results].map(([p, r]) => [p, r.photo]));
}

/** Photo for one place (cached). */
export async function getDestinationPhoto(place: string): Promise<DestinationPhoto | null> {
  return (await getDestinationPhotos([place])).get(place.trim()) ?? null;
}
