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
  /** A specific real place/tour the itinerary agent named, if any. Preferred over the title. */
  candidateName?: string;
  /** The city/destination the activity is in, if known. */
  destination?: string;
  /** Booking kind, if the activity is bookable. Flights get no research links. */
  kind?: string;
};

// Routine logistics steps where "what do people say" makes no sense.
const LOGISTICS = /^(check[\s-]?(in|out)\b|flight\b|fly\b|depart|arriv|transfer\b|airport\b|return flight|travel day)/i;

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

function query(s: ResearchSubject): string | null {
  const subject = (s.candidateName ?? simplifyTitle(s.title)).trim();
  if (!subject) return null;
  const dest = s.destination?.split(",")[0]?.trim();
  return dest && !subject.toLowerCase().includes(dest.toLowerCase()) ? `${subject} ${dest}` : subject;
}

/** Google + Reddit links for one activity, or [] when research makes no sense for it. */
export function buildResearchLinks(s: ResearchSubject): BookingLink[] {
  if (s.kind === "FLIGHT") return [];
  // A hotel check-in IS worth researching -- but by the hotel's name, which
  // the agent provides as candidateName. Without one, "Check in to budget
  // guesthouse" is a logistics step, not a place.
  if (!s.candidateName && LOGISTICS.test(s.title.trim())) return [];
  const q = query(s);
  if (!q) return [];

  const google = new URL("https://www.google.com/search");
  google.searchParams.set("q", q);
  const reddit = new URL("https://www.reddit.com/search/");
  reddit.searchParams.set("q", q);

  return [
    { provider: "Google", url: google.toString() },
    { provider: "Reddit", url: reddit.toString() },
  ];
}
