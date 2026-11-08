import { describe, expect, it } from "vitest";
import { buildBookingLinks, destinationFor, linksForStoredBooking, type LinkSearchParams } from "./bookingLinks";

const base = {
  originCity: "Detroit (DTW)",
  destination: "Barcelona",
  startDate: "2027-03-15",
  endDate: "2027-03-19",
  partySize: 2,
};

const param = (u: string, k: string) => new URL(u).searchParams.get(k);

describe("buildBookingLinks", () => {
  it("builds a round-trip Google Flights search from structured endpoints and dates", () => {
    const [link, ...rest] = buildBookingLinks({
      ...base,
      kind: "FLIGHT",
      searchHint: "ignored when structured data exists",
      date: "2027-03-15",
    });
    expect(rest).toHaveLength(0);
    expect(link!.provider).toBe("Google Flights");
    expect(new URL(link!.url).origin + new URL(link!.url).pathname).toBe(
      "https://www.google.com/travel/flights",
    );
    expect(param(link!.url, "q")).toBe(
      "Flights from Detroit (DTW) to Barcelona on 2027-03-15 returning 2027-03-19",
    );
  });

  it("falls back to the search hint for flights without an origin", () => {
    const [link] = buildBookingLinks({
      kind: "FLIGHT",
      searchHint: "Flight LIS to OPO on 2027-05-02",
      destination: "Porto",
    });
    expect(param(link!.url, "q")).toBe("Flight LIS to OPO on 2027-05-02");
  });

  it("searches hotels by candidate name with check-in/out and party size", () => {
    const links = buildBookingLinks({
      ...base,
      kind: "HOTEL",
      searchHint: "3-star hotel near Gothic Quarter",
      candidateName: "Hotel Jazz",
    });
    expect(links.map((l) => l.provider)).toEqual(["Booking.com", "Google Hotels", "Google Maps"]);
    const booking = links[0]!.url;
    expect(param(booking, "ss")).toBe("Hotel Jazz Barcelona");
    expect(param(booking, "checkin")).toBe("2027-03-15");
    expect(param(booking, "checkout")).toBe("2027-03-19");
    expect(param(booking, "group_adults")).toBe("2");
    expect(param(links[2]!.url, "query")).toBe("Hotel Jazz, Barcelona");
  });

  it("searches hotels by destination when no specific hotel was named, with no map link", () => {
    const links = buildBookingLinks({ ...base, kind: "HOTEL", searchHint: "boutique hotel" });
    expect(param(links[0]!.url, "ss")).toBe("Barcelona");
    expect(links.map((l) => l.provider)).not.toContain("Google Maps");
  });

  it("builds tour searches dated to the itinerary day", () => {
    const links = buildBookingLinks({
      ...base,
      kind: "TOUR",
      searchHint: "Skip-the-line Sagrada Familia ticket on 2027-03-16",
      candidateName: "Sagrada Familia",
      date: "2027-03-16",
    });
    expect(links.map((l) => l.provider)).toEqual(["GetYourGuide", "Viator", "Google Maps"]);
    expect(param(links[0]!.url, "q")).toBe("Sagrada Familia Barcelona");
    expect(param(links[0]!.url, "date_from")).toBe("2027-03-16");
    expect(param(links[1]!.url, "text")).toBe("Sagrada Familia Barcelona");
  });

  it("omits malformed dates instead of passing them to providers", () => {
    const links = buildBookingLinks({
      ...base,
      kind: "HOTEL",
      searchHint: "x",
      startDate: "Day 1",
      endDate: undefined,
    });
    expect(param(links[0]!.url, "checkin")).toBeNull();
    expect(param(links[0]!.url, "checkout")).toBeNull();
  });

  it("only ever produces https links to the known providers", () => {
    const kinds: LinkSearchParams["kind"][] = ["FLIGHT", "HOTEL", "TOUR", "RESERVATION"];
    const hosts = new Set<string>();
    for (const kind of kinds) {
      for (const l of buildBookingLinks({ ...base, kind, searchHint: "<script>&q=evil", candidateName: "A&B" })) {
        const u = new URL(l.url);
        expect(u.protocol).toBe("https:");
        hosts.add(u.host);
      }
    }
    expect([...hosts].sort()).toEqual([
      "www.booking.com",
      "www.getyourguide.com",
      "www.google.com",
      "www.viator.com",
    ]);
  });
});

describe("linksForStoredBooking", () => {
  it("handles legacy rows that only stored a searchHint", () => {
    const [link] = linksForStoredBooking("FLIGHT", JSON.stringify({ searchHint: "DTW to BCN 2027-03-15" }));
    expect(param(link!.url, "q")).toBe("DTW to BCN 2027-03-15");
  });

  it("survives corrupt JSON rather than breaking the trip page", () => {
    expect(() => linksForStoredBooking("TOUR", "{not json")).not.toThrow();
  });
});

describe("query quality", () => {
  it("searches tours by activity title rather than the agent's long hint", () => {
    const [gyg] = buildBookingLinks({
      ...base,
      kind: "TOUR",
      title: "La Boqueria market tapas tour",
      searchHint: "La Boqueria market and Gothic Quarter food walking tour in Barcelona, 2027-03-17 morning",
      date: "2027-03-17",
    });
    expect(param(gyg!.url, "q")).toBe("La Boqueria market tapas tour Barcelona");
  });

  it("doesn't repeat the destination when the title already names it", () => {
    const [gyg] = buildBookingLinks({ ...base, kind: "TOUR", title: "Barcelona food tour", searchHint: "x" });
    expect(param(gyg!.url, "q")).toBe("Barcelona food tour");
  });

  it("labels the return flight as the same round-trip search, outbound has no note", () => {
    const out = buildBookingLinks({ ...base, kind: "FLIGHT", searchHint: "x", date: "2027-03-15" });
    const ret = buildBookingLinks({ ...base, kind: "FLIGHT", searchHint: "x", date: "2027-03-19" });
    expect(out[0]!.note).toBeUndefined();
    expect(ret[0]!.note).toMatch(/round-trip/);
    expect(ret[0]!.url).toBe(out[0]!.url);
  });
});

describe("review fixes", () => {
  it("gives a mid-trip flight its own one-way search instead of the round trip", () => {
    const [link] = buildBookingLinks({
      ...base,
      kind: "FLIGHT",
      searchHint: "Flight Barcelona BCN to Madrid MAD on 2027-03-17",
      date: "2027-03-17",
    });
    expect(param(link!.url, "q")).toBe("Flight Barcelona BCN to Madrid MAD on 2027-03-17");
    expect(link!.note).toBeUndefined();
  });

  it("only labels a final-day flight as the return leg", () => {
    const [ret] = buildBookingLinks({ ...base, kind: "FLIGHT", searchHint: "x", date: "2027-03-19" });
    expect(ret!.note).toMatch(/round-trip/);
  });

  it("doesn't claim a round trip when the return search can't be built", () => {
    const [ret] = buildBookingLinks({
      kind: "FLIGHT",
      searchHint: "Flight BCN to DTW on 2027-03-19",
      startDate: "2027-03-15",
      endDate: "2027-03-19",
      date: "2027-03-19",
    });
    expect(ret!.note).toBeUndefined();
  });

  it.each(["null", "42", "[1,2]", '"str"'])("survives stored JSON %s without throwing", (raw) => {
    expect(() => linksForStoredBooking("HOTEL", raw)).not.toThrow();
  });

  it("reuses the maps builder for unknown kinds", () => {
    const [link] = buildBookingLinks({ kind: "RESERVATION", searchHint: "Cal Pep Barcelona" });
    expect(link!.provider).toBe("Google Maps");
    expect(param(link!.url, "query")).toBe("Cal Pep Barcelona");
  });
});

describe("destinationFor", () => {
  it("always uses the only destination on single-city trips", () => {
    expect(destinationFor(["Barcelona"], "Prado Museum tour")).toBe("Barcelona");
  });

  it("picks the destination the item mentions on multi-city trips", () => {
    expect(destinationFor(["Barcelona", "Madrid"], undefined, "Prado tour", "Prado Museum tour in Madrid on 2027-03-18")).toBe("Madrid");
  });

  it("matches on the leading place name and is case-insensitive", () => {
    expect(destinationFor(["Barcelona, Spain", "Madrid, Spain"], "skip-the-line PRADO, madrid")).toBe("Madrid, Spain");
  });

  it("returns undefined rather than guessing when no destination is mentioned", () => {
    expect(destinationFor(["Barcelona", "Madrid"], "Flamenco show")).toBeUndefined();
  });
});
