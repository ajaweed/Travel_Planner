// "See what people say" links: let travellers vet a place on sources they
// already trust (Google reviews/search, Reddit threads) before they choose or
// book it.
//
// Same rule as bookingLinks.ts: every URL is built DETERMINISTICALLY from the
// activity's name and city -- never written by the model. We deliberately do
// not fetch or scrape these sites (Google's terms forbid scraping search
// results; Reddit's API needs approval and restricts AI use). The links put
// the traveller in front of the real sources instead.

import type { BookingLink } from "./bookingLinks";

export type ResearchSubject = {
  /** The activity title as shown in the itinerary. */
  title: string;
  /**
   * The specific real place/tour to search for, if known -- preferably the
   * name the reviews provider resolved, else the itinerary agent's candidate.
   * Preferred over the title.
   */
  candidateName?: string;
  /** The city/destination the activity is in, if known. */
  destination?: string;
  /** Booking kind, if the activity is bookable. Flights get no research links. */
  kind?: string;
};

const LODGING = "(?:hotel|guesthouse|guest house|hostel|apartment|room|ryokan|accommodation|airbnb|lodging|villa|b&b)";

// Routine logistics steps where "what do people say" makes no sense. Each
// pattern is word-bounded and specific, so sightseeing that merely starts with
// a similar word ("Check out LX Factory", "Department store shopping") keeps
// its links, while logistics phrased any which way ("Hotel check-in", "Taxi
// transfer to hotel", "Head to the airport") doesn't get them.
const LOGISTICS: RegExp[] = [
  /\bcheck[\s-]?in\b/i,
  new RegExp(`\\bcheck[\\s-]?out\\s+(?:of|from)\\b`, "i"),
  new RegExp(`\\bcheck[\\s-]?out\\s+(?:the\\s+|your\\s+)?${LODGING}\\b`, "i"),
  new RegExp(`\\b${LODGING}\\s+check[\\s-]?out\\b`, "i"),
  /\bcheck[\s-]?out\s*$/i,
  /\bcheckout\b/i,
  /\bflights?\b/i,
  /\bairport\b/i,
  /\btransfers?\b/i,
  /\b(?:departure|depart|departing|arrival|arrive|arriving)\b/i,
  // Anchored: "Train to Porto" is logistics, "Day trip by train to Sintra" is an activity.
  /^(?:take\s+(?:the\s+|a\s+)?)?(?:train|bus|coach|taxi|uber)\s+(?:to|from|back)\b/i,
  /^(?:head|return|travel)\s+(?:back\s+)?(?:to|home)\b/i,
  /\b(?:pack(?:ing)?\s+up|travel\s+day|settle\s+in)\b/i,
];

export function isLogistics(title: string): boolean {
  const t = title.trim();
  return LOGISTICS.some((re) => re.test(t));
}

// Leading filler that only describes HOW you'd do the thing. Search engines --
// Reddit's especially, which matches keywords literally -- do better on the
// place itself: "Self-guided visit to Castelo de São Jorge" -> "Castelo de São Jorge".
const FILLER =
  /^(?:(?:self-guided|guided|free|small-group|private|casual|low-key|easy|leisurely|evening|morning|afternoon|sunset|quick)\s+)*(?:visit(?:\s+to)?|walk(?:ing)?(?:\s+tour)?(?:\s+(?:of|through|around|along))?|stroll(?:\s+(?:through|along|around))?|explore|exploring|browse|browsing|wander(?:\s+(?:through|around))?|tour\s+of)\s+/i;

/** Make an activity title search-friendly; named places are used as-is. */
export function simplifyTitle(title: string): string {
  const cleaned = title
    .replace(/\([^)]*\)/g, " ") // "(Time Out Market)"
    .replace(/\s+if open\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const stripped = cleaned.replace(FILLER, "").trim();
  // Never strip a title down to nothing useful.
  return stripped.length >= 3 ? stripped : cleaned;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True if `text` contains `word` as a whole word (Unicode-aware: "Bathhouse" doesn't contain "Bath"). */
function containsWord(text: string, word: string): boolean {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(word)}($|[^\\p{L}\\p{N}])`, "iu").test(text);
}

/** "<subject> <city>", unless the subject already names the city (whole word). Shared with food links. */
export function withDestination(subject: string, destination: string | undefined): string {
  const dest = destination?.split(",")[0]?.trim();
  return dest && !containsWord(subject, dest) ? `${subject} ${dest}` : subject;
}

/** Google + Reddit links for one activity, or [] when research makes no sense for it. */
export function buildResearchLinks(s: ResearchSubject): BookingLink[] {
  if (s.kind === "FLIGHT") return [];
  // Blank strings count as missing, so they fall back instead of suppressing links.
  const name = s.candidateName?.trim() || undefined;
  const destination = s.destination?.trim() || undefined;
  // A hotel check-in IS worth researching -- by the hotel's name. Without a
  // name, "Check in to budget guesthouse" is a logistics step, not a place.
  if (!name && isLogistics(s.title)) return [];

  const subject = name ?? simplifyTitle(s.title);
  if (!subject) return [];
  const q = withDestination(subject, destination);

  const google = new URL("https://www.google.com/search");
  google.searchParams.set("q", q);
  const reddit = new URL("https://www.reddit.com/search/");
  reddit.searchParams.set("q", q);

  return [
    { provider: "Google", url: google.toString() },
    { provider: "Reddit", url: reddit.toString() },
  ];
}
