// Photos for individual itinerary stops ("Burj Khalifa 'At the Top'",
// "Browse the Gold, Spice and Textile Souks"). Same sources and license rules
// as destination photos (./destinationPhoto), found via Wikipedia search.
//
// Search results are often wrong ("Relax at a miradouro" -> Luanda), and a
// photo of the wrong place is worse than none. So a result is only used when:
//   1. the stop names a specific place (a proper noun other than the city),
//   2. the article has coordinates within MAX_DISTANCE_KM of the stop's city,
//   3. the article's name matches the stop's own words (see `titleMatches`).
// Anything else gets no photo and keeps its icon.

import { isLogistics, simplifyTitle } from "./researchLinks";
import {
  type Coords,
  type Credit,
  type DestinationPhoto,
  distanceKm,
  fileCredits,
  getPlaceResults,
  looksLikePhoto,
  placeLabel,
  readPage,
} from "./destinationPhoto";
import { ttlCache } from "./ttlCache";
import { WIKIPEDIA_API, WikimediaUnavailable, wikiQuery } from "./wikimedia";

export type Stop = {
  id: string;
  title: string;
  description?: string | null;
  /** The city the stop is in ("Lisbon, Portugal"); no city, no photo. */
  city?: string;
  /** Booking kind; flights and hotels get no stop photo. */
  kind?: string;
};

export const MAX_DISTANCE_KM = 60;
const SEARCH_RESULTS = 5;
const MIN_TOKEN_OVERLAP = 0.6;

const STOPWORDS = new Set(
  "the and with for from into onto at to of in on by a an or de da do dos das del la le les el los il di du des van von der den y e".split(" "),
);

// Words that name a *kind* of place. A match on these alone ("Market",
// "Beach") doesn't show the article is the stop's place.
const GENERIC = new Set(
  (
    "museum market markets beach park tower district old town city square street walk palace church cathedral " +
    "garden gardens bridge river creek mall souk souks centre center historic historical national island lake " +
    "mountain castle fort harbour harbor port bay quarter neighbourhood neighborhood area waterfront fountain " +
    "show tour tours viewpoint view food wine dinner lunch breakfast restaurant cafe bar night evening morning " +
    "temple shrine gallery art library station boardwalk marina promenade desert safari"
  ).split(" "),
);

/** Lowercase, accent-free, possessive-free word tokens of 3+ letters, minus stopwords. */
export function tokens(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** Same word, allowing one to extend the other (4+ letters): "souk"/"souks". Shared with restaurantChecks. */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  // "souk"/"souks", "historic"/"historical", "lisbon"/"lisboa" is NOT this (different 5th letter).
  return Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a));
}

/**
 * Does a search result's title name the stop's place? Either the stop's text
 * contains the whole title as a phrase ("Dubai Fountain show at dusk" vs
 * "Dubai Fountain"), or most of the title's words (city words aside) appear in
 * the stop's text and at least one of those is distinctive, not just "Market".
 */
export function titleMatches(resultTitle: string, stopText: string, city: string): boolean {
  const titleTokens = tokens(resultTitle.replace(/\([^)]*\)/g, " "));
  const textTokens = tokens(stopText);
  const cityTokens = tokens(city);
  if (titleTokens.length === 0) return false;

  const phrase = titleTokens.join(" ");
  if (titleTokens.length >= 2 && ` ${textTokens.join(" ")} `.includes(` ${phrase} `)) return true;

  const own = titleTokens.filter((t) => !cityTokens.some((c) => sameWord(t, c)));
  if (own.length === 0) return false;
  const matched = own.filter((t) => textTokens.some((w) => sameWord(t, w)));
  return matched.length / own.length >= MIN_TOKEN_OVERLAP && matched.some((t) => !GENERIC.has(t));
}

// Lowercase words allowed *inside* a name: "Castelo de São Jorge", "Mercado da Ribeira".
const CONNECTORS = new Set(["de", "da", "do", "dos", "das", "del", "di", "du", "la", "le", "el", "of", "and", "y", "e"]);
export const MAX_QUERIES_PER_STOP = 3;
// Capitalised only because they open the sentence: "Browse Mercado da Ribeira".
const LEADING_VERBS = new Set(
  ("browse visit explore wander stroll walk relax enjoy see try take ride sunset evening morning afternoon " +
    "free casual last rest head dinner lunch breakfast shop shopping hike climb swim day half full").split(" "),
);

/**
 * Named places in a title: runs of capitalised words (with connectors inside),
 * e.g. "Browse Mercado da Ribeira (Time Out Market) and Feira da Ladra" ->
 * ["Mercado da Ribeira", "Time Out Market", "Feira da Ladra"]. Drops a lone
 * capitalised first word (that's the sentence's verb: "Relax", "Browse"),
 * runs that are only the city, and runs that are only generic words.
 */
export function namedPlaces(title: string, city: string): string[] {
  const cityTokens = tokens(city);
  const words = title.split(/\s+/).filter(Boolean);
  const runs: Array<{ words: string[]; start: number }> = [];
  let cur: { words: string[]; start: number } | null = null;
  const flush = () => {
    if (cur) {
      while (cur.words.length && CONNECTORS.has(cur.words[cur.words.length - 1]!.toLowerCase())) cur.words.pop();
      if (cur.words.length) runs.push(cur);
    }
    cur = null;
  };
  words.forEach((raw, i) => {
    // "(" and opening quotes start a new name: "Burj Khalifa 'At the Top'".
    if (/^[("'‘“]/u.test(raw)) flush();
    const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").replace(/['’]s$/u, "");
    const capital = /^\p{Lu}/u.test(word);
    if (word && capital) {
      if (cur) cur.words.push(word);
      else cur = { words: [word], start: i };
    } else if (word && cur && CONNECTORS.has(word.toLowerCase())) {
      cur.words.push(word);
    } else {
      flush();
    }
    // Punctuation after a word ends the name: "Gold, Spice" are two names.
    if (/[,;:)!?]$|['’]$/u.test(raw)) flush();
  });
  flush();

  const out: string[] = [];
  for (const run of runs) {
    if (run.start === 0 && LEADING_VERBS.has(run.words[0]!.toLowerCase())) {
      run.words.shift();
      while (run.words.length && CONNECTORS.has(run.words[0]!.toLowerCase())) run.words.shift();
    }
    if (run.words.length === 0) continue;
    // A lone capitalised first word is just the sentence start ("Kayaking near ...").
    const loneFirstWord = run.start === 0 && run.words.length === 1 && words[0]!.startsWith(run.words[0]!);
    if (loneFirstWord) continue;
    const t = tokens(run.words.join(" "));
    if (t.length === 0) continue;
    if (t.every((x) => cityTokens.some((c) => sameWord(x, c)))) continue;
    if (t.every((x) => GENERIC.has(x))) continue;
    const phrase = run.words.join(" ");
    if (!out.includes(phrase)) out.push(phrase);
  }
  // Multi-word names are the most specific; try those first.
  return out.sort((a, b) => b.split(" ").length - a.split(" ").length);
}

/**
 * Search queries for a stop (most specific first), or [] when it doesn't name
 * a specific place: logistics, flights/hotels, or nothing named besides the
 * city ("Casual dinner at a local tasca", "Rest and orient yourself").
 */
export function stopQueries(stop: Stop): string[] {
  if (!stop.city || stop.kind === "FLIGHT" || stop.kind === "HOTEL" || isLogistics(stop.title)) return [];
  const city = placeLabel(stop.city);
  const withCity = (q: string) => (tokens(q).some((t) => tokens(city).includes(t)) ? q : `${q} ${city}`);
  const names = namedPlaces(stop.title, city).slice(0, MAX_QUERIES_PER_STOP);
  if (names.length === 0) return [];
  // Last resort: the whole (simplified) title, which carries context a bare
  // name lacks ("Gold, Spice and Textile Souks" finds "Dubai Gold Souk").
  const whole = withCity(simplifyTitle(stop.title));
  const queries = names.map(withCity);
  return queries.includes(whole) ? queries : [...queries, whole];
}

type Candidate = { title: string; image: string };

/** Search results for the stop that pass every check, best first. */
async function findCandidates(query: string, stop: Stop, cityCoords: Coords): Promise<Candidate[]> {
  const json = await wikiQuery(WIKIPEDIA_API, {
    generator: "search",
    gsrsearch: query,
    gsrlimit: String(SEARCH_RESULTS),
    gsrnamespace: "0",
    redirects: "1",
    prop: "pageimages|pageprops|coordinates",
    piprop: "name",
  });
  const pages: any[] = [...(json?.query?.pages ?? [])].sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
  const stopText = `${stop.title} ${stop.description ?? ""}`;
  const cityName = placeLabel(stop.city!);
  const out: Candidate[] = [];
  for (const raw of pages) {
    const page = readPage(raw);
    if (!page?.image || !page.coords || page.disambiguation || !looksLikePhoto(page.image)) continue;
    if (tokens(page.title).join(" ") === tokens(cityName).join(" ")) continue; // the city itself
    if (distanceKm(cityCoords, page.coords) > MAX_DISTANCE_KM) continue;
    if (!titleMatches(page.title, stopText, cityName)) continue;
    out.push({ title: page.title, image: page.image });
  }
  return out;
}

// ----------------------------------------------------------------- cache

const HIT_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 60 * 1000;
// One trip load may spend at most this many searches; the rest of its stops
// are looked up on later visits (they stay uncached until then). Keeps one
// long itinerary from eating the shared per-minute Wikimedia budget.
export const MAX_SEARCHES_PER_CALL = 24;
const stopCache = ttlCache<Omit<DestinationPhoto, "place"> | null>("stops", 2000);

/** Test-only. */
export function resetStopPhotoCache(): void {
  stopCache.clear();
}

/** The match depends on title, description and city, so all three are in the key. */
function stopKey(stop: Stop): string {
  return [stop.title, stop.description ?? "", stop.city ?? ""].map((x) => x.trim().toLowerCase()).join("|");
}

/**
 * Photos for itinerary stops, keyed by stop id. Stops without a confident
 * match are absent. Never throws: when Wikimedia is unavailable (or this
 * call's search budget runs out) the affected stops are simply absent and NOT
 * cached, so a later call retries them.
 */
export async function getStopPhotos(stops: Stop[], now: number = Date.now()): Promise<Map<string, DestinationPhoto>> {
  const out = new Map<string, DestinationPhoto>();
  const withQuery = stops.flatMap((s) => {
    const queries = stopQueries(s);
    return queries.length ? [{ stop: s, queries, key: stopKey(s) }] : [];
  });
  const todo = [...new Map(withQuery.map((t) => [t.key, t])).values()].filter(
    ({ key }) => stopCache.get(key, now) === undefined,
  );

  if (todo.length > 0) {
    let places: Awaited<ReturnType<typeof getPlaceResults>>;
    try {
      // Cities come from our own trip data: not subject to the public cap.
      places = await getPlaceResults([...new Set(todo.map((t) => t.stop.city!))], { now });
    } catch {
      places = new Map();
    }

    let budget = MAX_SEARCHES_PER_CALL;
    const found = new Map<string, Candidate[]>(); // by cache key; absent = not looked up
    await Promise.all(
      todo.map(async ({ stop, queries, key }) => {
        const coords = places.get(stop.city!.trim())?.coords;
        if (!coords) return; // can't verify location: unknown, not a miss
        try {
          // Most specific name first; stop at the first query with confident
          // matches. All of them are kept: a match whose photo turns out not
          // to be freely licensed falls through to the next.
          let cands: Candidate[] = [];
          for (const q of queries) {
            if (budget <= 0) return; // out of budget: leave uncached for next time
            budget--;
            cands = await findCandidates(q, stop, coords);
            if (cands.length) break;
          }
          found.set(key, cands);
        } catch (err) {
          if (!(err instanceof WikimediaUnavailable)) found.set(key, []);
        }
      }),
    );

    let credits = new Map<string, Credit>();
    const images = [...found.values()].flatMap((cs) => cs.map((c) => c.image));
    let creditsOk = true;
    if (images.length > 0) {
      try {
        credits = await fileCredits(WIKIPEDIA_API, images);
      } catch {
        creditsOk = false;
      }
    }

    for (const [key, cands] of found) {
      if (cands.length && !creditsOk) continue; // licenses unknown right now: retry later
      const cand = cands.find((c) => credits.has(c.image));
      const photo = cand ? { subject: cand.title, ...credits.get(cand.image)! } : null;
      stopCache.set(key, photo, photo ? HIT_TTL_MS : MISS_TTL_MS, now);
    }
  }

  for (const { stop, key } of withQuery) {
    const photo = stopCache.get(key, now);
    if (photo) out.set(stop.id, { ...photo, place: stop.title });
  }
  return out;
}
