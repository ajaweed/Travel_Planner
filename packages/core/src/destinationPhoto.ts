// Destination photos: the lead image of the place's Wikipedia article, used
// only when the file is freely licensed on Wikimedia Commons. Every photo
// carries its credit (author, license, source page) and the UI must show it.
// See docs/visual-design.md §3.
//
// Why Wikipedia's lead image: it's chosen by editors to represent *that*
// place, so a Lisbon trip shows Lisbon, not a stock beach. Why not a stock API:
// those need keys and show generic scenery.

export type DestinationPhoto = {
  /** The place we looked up, as given. */
  place: string;
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

type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal; cache?: "no-store" },
) => Promise<{
  ok: boolean;
  json(): Promise<any>;
}>;

// Wikipedia first; Wikivoyage (travel guide, same Commons images) fills gaps
// such as a city whose Wikipedia lead image isn't on Commons.
export const PHOTO_SOURCES = ["https://en.wikipedia.org/w/api.php", "https://en.wikivoyage.org/w/api.php"];
// Wikimedia asks automated clients to identify themselves.
const HEADERS = { "User-Agent": "TripPlannerAI/0.1 (destination photos)", "Api-User-Agent": "TripPlannerAI/0.1" };
const WIDTH = 1920;
// Wikimedia's standard thumbnail steps (other widths are rate-limited).
const SRCSET_WIDTHS = [500, 960, 1280, 1920];
// One deadline for the whole lookup (every request shares it), so a slow
// Wikimedia can't hold a request open for long.
const LOOKUP_DEADLINE_MS = 8000;

// Lead images are sometimes a flag, map, logo or locator diagram. We only
// want photographs.
const NOT_A_PHOTO = /\b(flag|map|coat[ _]of[ _]arms|locator|location|logo|seal|emblem|montage|collage|diagram|svg)\b/i;
const PHOTO_MIME = new Set(["image/jpeg", "image/webp"]);
// Free licenses only. Non-free (fair-use) files live on en.wikipedia and
// can't be reused here.
const FREE_LICENSE = /^(cc[ -]?(by|zero|0)|cc0|public domain|pd\b|attribution)/i;
// NonCommercial / NoDerivatives Creative Commons variants aren't free licenses.
const RESTRICTED_LICENSE = /\b(nc|nd)\b/i;

/** Normalised key for caching a place's photo (shared by server and client caches). */
export function photoCacheKey(place: string): string {
  return place.trim().toLowerCase();
}

/** The short name shown on a photo: "Lisbon" for "Lisbon, Portugal". */
export function placeLabel(place: string): string {
  return place.split(",")[0]!.trim() || place.trim();
}

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

/**
 * Thumbnail URLs carry their width as ".../1920px-Name.jpg"; swapping it gives
 * the other standard sizes. Returns "" if the URL doesn't have that shape.
 */
export function buildSrcSet(src: string): string {
  if (!/\/\d+px-[^/]+$/.test(src.split("?")[0]!)) return "";
  return SRCSET_WIDTHS.map((w) => `${src.replace(/\/\d+px-([^/?]+)(\?|$)/, `/${w}px-$1$2`)} ${w}w`).join(", ");
}

/** Titles to try, most specific first: "Lisbon, Portugal" then "Lisbon". */
export function candidateTitles(place: string): string[] {
  const full = place.trim();
  if (!full) return [];
  const head = placeLabel(full);
  return head && head !== full ? [full, head] : [full];
}

type Ctx = { fetchFn: FetchLike; signal: AbortSignal };

// no-store: Next's server fetch cache would otherwise keep Wikimedia answers
// with no expiry, overriding the TTLs below.
function get(url: string, ctx: Ctx) {
  return ctx.fetchFn(url, { headers: HEADERS, signal: ctx.signal, cache: "no-store" });
}

async function leadImageName(api: string, title: string, ctx: Ctx): Promise<string | undefined> {
  const url =
    `${api}?action=query&format=json&formatversion=2&redirects=1` +
    `&prop=pageimages|pageprops&piprop=name&titles=${encodeURIComponent(title)}`;
  const res = await get(url, ctx);
  if (!res.ok) return undefined;
  const page = (await res.json())?.query?.pages?.[0];
  if (!page || page.missing || page.pageprops?.disambiguation !== undefined) return undefined;
  const name: unknown = page.pageimage;
  return typeof name === "string" && !NOT_A_PHOTO.test(name.replace(/_/g, " ")) ? name : undefined;
}

async function imageDetails(api: string, place: string, fileName: string, ctx: Ctx): Promise<DestinationPhoto | null> {
  const url =
    `${api}?action=query&format=json&formatversion=2&prop=imageinfo` +
    `&iiprop=url|mime|extmetadata&iiurlwidth=${WIDTH}` +
    `&iiextmetadatafilter=Artist|LicenseShortName|LicenseUrl|NonFree` +
    `&titles=${encodeURIComponent(`File:${fileName}`)}`;
  const res = await get(url, ctx);
  if (!res.ok) return null;
  const page = (await res.json())?.query?.pages?.[0];
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
    place,
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

/** One source's photo for one title; null on any failure, so other sources still get tried. */
async function fromSource(api: string, place: string, title: string, ctx: Ctx): Promise<DestinationPhoto | null> {
  try {
    const name = await leadImageName(api, title, ctx);
    return name ? await imageDetails(api, place, name, ctx) : null;
  } catch {
    return null;
  }
}

/**
 * Looks up a freely licensed photo of `place`. Returns null when there isn't
 * a suitable one (no article, lead image is a flag/map, non-free license) or
 * on any network/API failure -- photos are decoration and must never break a
 * page. Sources are queried in parallel per title; Wikipedia wins ties.
 */
export async function lookupDestinationPhoto(
  place: string,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): Promise<DestinationPhoto | null> {
  const ctx: Ctx = { fetchFn, signal: AbortSignal.timeout(LOOKUP_DEADLINE_MS) };
  for (const title of candidateTitles(place)) {
    if (ctx.signal.aborted) break;
    const found = await Promise.all(PHOTO_SOURCES.map((api) => fromSource(api, place, title, ctx)));
    const photo = found.find((p) => p !== null);
    if (photo) return photo;
  }
  return null;
}

const HIT_TTL_MS = 24 * 60 * 60 * 1000;
// A miss may be a transient network failure, so it's retried sooner.
const MISS_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 500;
// The endpoint is public: cap uncached lookups so a script feeding it random
// places can't make us hammer Wikimedia (and get this app blocked).
export const MAX_COLD_LOOKUPS_PER_MINUTE = 30;
const cache = new Map<string, { expires: number; value: Promise<DestinationPhoto | null> }>();
let coldWindow = { start: 0, count: 0 };

/**
 * `lookupDestinationPhoto` with an in-process cache (24h for hits, 10min for
 * misses) and a global cap on uncached lookups. Over the cap it returns null
 * without caching, so the place gets a real lookup next time.
 */
export function getDestinationPhoto(
  place: string,
  lookup: (place: string) => Promise<DestinationPhoto | null> = lookupDestinationPhoto,
  now: number = Date.now(),
): Promise<DestinationPhoto | null> {
  const trimmed = place.trim();
  const key = photoCacheKey(trimmed);
  // A cached photo is shared across callers; stamp each caller's own spelling on it.
  const forCaller = (p: Promise<DestinationPhoto | null>) => p.then((photo) => photo && { ...photo, place: trimmed });

  const hit = cache.get(key);
  if (hit && now < hit.expires) return forCaller(hit.value);
  cache.delete(key);

  if (now - coldWindow.start >= 60_000) coldWindow = { start: now, count: 0 };
  if (coldWindow.count >= MAX_COLD_LOOKUPS_PER_MINUTE) return Promise.resolve(null);
  coldWindow.count++;

  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  const value = lookup(trimmed);
  // Concurrent requests for the same place share this in-flight promise.
  const entry = { expires: now + HIT_TTL_MS, value };
  cache.set(key, entry);
  void value.then((photo) => {
    if (!photo) entry.expires = now + MISS_TTL_MS;
  });
  return forCaller(value);
}

/** Test-only: clears the cache and the cold-lookup window. */
export function resetDestinationPhotoCache(): void {
  cache.clear();
  coldWindow = { start: 0, count: 0 };
}
