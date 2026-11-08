// Booking links: the app no longer books anything on the user's behalf.
// Each bookable item in a chosen itinerary gets a few links the user clicks
// to search and book it themselves on the provider's own site.
//
// Every URL here is built DETERMINISTICALLY from structured trip data --
// never written by the model. An LLM asked for a URL invents plausible-looking
// deep links that 404 (or point somewhere else entirely); a search URL built
// from the place name and dates always lands on a real results page.
//
// These are plain public search URLs: no API keys, no affiliate IDs, no
// provider approval needed, and nothing here can spend the user's money.

import type { BookingKind } from "@trip-planner/db";

/** What's stored in Booking.searchParamsJson for link-out items. */
export type LinkSearchParams = {
  kind: BookingKind;
  /** The itinerary agent's free-text description of what to search for. */
  searchHint: string;
  /** The activity's short title as shown in the itinerary, e.g. "Guided tour of Sagrada Familia". */
  title?: string;
  /** A specific real hotel/tour name, when the itinerary agent named one. */
  candidateName?: string;
  /** The date this item happens on (the itinerary day), YYYY-MM-DD. */
  date?: string;
  originCity?: string;
  destination?: string;
  /** Whole-trip window, used for round-trip flights and hotel check-in/out. */
  startDate?: string;
  endDate?: string;
  partySize?: number;
};

export type BookingLink = {
  /** Provider display name, e.g. "Google Flights". */
  provider: string;
  url: string;
  /** Optional one-line context shown under the link. */
  note?: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s: string | undefined): s is string => !!s && ISO_DATE.test(s);

function url(base: string, params: Record<string, string | number | undefined>): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
  }
  return u.toString();
}

function flightLinks(p: LinkSearchParams): BookingLink[] {
  // Google Flights' `q` takes natural language and parses origin,
  // destination and dates itself -- far more robust than its encoded `tfs`
  // parameter, which is undocumented.
  // Itineraries carry an outbound flight on the first day and a return on the
  // last day, and people book those together as one round trip. Any other
  // flight (a mid-trip leg between cities) is its own one-way search, built
  // from the agent's hint, which the itinerary prompt requires to name both
  // endpoints and the date.
  const isOutbound = !isDate(p.date) || p.date === p.startDate;
  const isReturnLeg = isDate(p.date) && isDate(p.endDate) && p.date === p.endDate && !isOutbound;
  const isRoundTrip = isOutbound || isReturnLeg;

  let q: string;
  if (isRoundTrip && p.originCity && p.destination) {
    q = `Flights from ${p.originCity} to ${p.destination}`;
    if (isDate(p.startDate)) q += ` on ${p.startDate}`;
    if (isDate(p.endDate)) q += ` returning ${p.endDate}`;
  } else {
    // Without structured endpoints, fall back to the agent's hint, which the
    // itinerary prompt requires to contain origin, destination and date.
    q = p.searchHint;
  }
  return [
    {
      provider: "Google Flights",
      url: url("https://www.google.com/travel/flights", { q }),
      ...(isReturnLeg && p.originCity && p.destination
        ? { note: "Same round-trip search as your outbound flight" }
        : {}),
    },
  ];
}

function hotelLinks(p: LinkSearchParams): BookingLink[] {
  const where = p.destination ?? "";
  const query = p.candidateName ? `${p.candidateName} ${where}`.trim() : where || p.searchHint;
  const checkin = isDate(p.startDate) ? p.startDate : undefined;
  const checkout = isDate(p.endDate) ? p.endDate : undefined;
  return [
    {
      provider: "Booking.com",
      url: url("https://www.booking.com/searchresults.html", {
        ss: query,
        checkin,
        checkout,
        group_adults: p.partySize,
        no_rooms: 1,
      }),
    },
    {
      provider: "Google Hotels",
      url: url("https://www.google.com/travel/search", {
        q: [query, checkin && checkout ? `${checkin} to ${checkout}` : ""].filter(Boolean).join(" "),
      }),
    },
  ];
}

function tourLinks(p: LinkSearchParams): BookingLink[] {
  // Tour sites match on short keyword queries; the agent's searchHint is a
  // full sentence with dates and times of day in it, which matches poorly.
  // Prefer a named tour, then the activity title, and only then the hint.
  const subject = p.candidateName ?? p.title;
  const query = subject
    ? p.destination && !subject.toLowerCase().includes(p.destination.toLowerCase())
      ? `${subject} ${p.destination}`
      : subject
    : p.searchHint;
  const date = isDate(p.date) ? p.date : undefined;
  return [
    {
      provider: "GetYourGuide",
      url: url("https://www.getyourguide.com/s/", { q: query, date_from: date, date_to: date }),
    },
    { provider: "Viator", url: url("https://www.viator.com/searchResults/all", { text: query }) },
  ];
}

function mapLink(p: LinkSearchParams, fallbackQuery?: string): BookingLink[] {
  if (!p.candidateName && !fallbackQuery) return [];
  const query = p.candidateName
    ? p.destination
      ? `${p.candidateName}, ${p.destination}`
      : p.candidateName
    : fallbackQuery!;
  return [
    {
      provider: "Google Maps",
      url: url("https://www.google.com/maps/search/", { api: 1, query }),
    },
  ];
}

/** Search links for one bookable item, best option first. */
export function buildBookingLinks(p: LinkSearchParams): BookingLink[] {
  switch (p.kind) {
    case "FLIGHT":
      return flightLinks(p);
    case "HOTEL":
      return [...hotelLinks(p), ...mapLink(p)];
    case "TOUR":
      return [...tourLinks(p), ...mapLink(p)];
    default:
      // RESERVATION is excluded from itineraries (no provider); if one ever
      // appears, a maps search on the hint is the most useful honest link.
      return mapLink({ ...p, candidateName: undefined }, p.searchHint);
  }
}

/**
 * Which of the trip's destinations an item is in. The itinerary agent doesn't
 * tag days with a city, so on a multi-city trip we take the first destination
 * the item's own text mentions; if none is mentioned we return undefined and
 * let the builders fall back to the item's text, rather than wrongly pinning
 * a Madrid tour to Barcelona. Single-destination trips always get that one.
 */
export function destinationFor(destinations: string[], ...texts: Array<string | undefined>): string | undefined {
  if (destinations.length <= 1) return destinations[0];
  const haystack = texts.filter(Boolean).join(" ").toLowerCase();
  // Match on the leading place name ("Barcelona, Spain" -> "barcelona").
  return destinations.find((d) => {
    const name = d.split(",")[0]!.trim().toLowerCase();
    return name.length > 0 && haystack.includes(name);
  });
}

/**
 * Reads a Booking row's stored searchParamsJson. Rows created before the
 * link-out change only stored { searchHint }; those still get hint-based links.
 */
export function linksForStoredBooking(kind: string, searchParamsJson: string): BookingLink[] {
  let stored: Partial<LinkSearchParams> = {};
  try {
    const parsed: unknown = JSON.parse(searchParamsJson);
    // JSON.parse happily returns null, numbers or arrays; only a plain object
    // is usable, and anything else must not take down the trip page.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      stored = parsed as Partial<LinkSearchParams>;
    }
  } catch {
    // Fall through with empty params rather than failing the whole trip page.
  }
  return buildBookingLinks({
    ...stored,
    kind: kind as BookingKind,
    searchHint: stored.searchHint ?? "",
  });
}
