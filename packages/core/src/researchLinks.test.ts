import { describe, expect, it } from "vitest";
import { buildResearchLinks, simplifyTitle } from "./researchLinks";

const q = (u: string) => new URL(u).searchParams.get("q");

describe("buildResearchLinks", () => {
  it("builds Google and Reddit searches from the activity and city", () => {
    const links = buildResearchLinks({ title: "Explore Park Güell", destination: "Barcelona" });
    expect(links.map((l) => l.provider)).toEqual(["Google", "Reddit"]);
    expect(new URL(links[0]!.url).origin + new URL(links[0]!.url).pathname).toBe("https://www.google.com/search");
    expect(new URL(links[1]!.url).origin + new URL(links[1]!.url).pathname).toBe("https://www.reddit.com/search/");
    expect(q(links[0]!.url)).toBe("Park Güell Barcelona");
    expect(q(links[1]!.url)).toBe("Park Güell Barcelona");
  });

  it("prefers the named place over the title", () => {
    const [g] = buildResearchLinks({
      title: "Check in to Hotel Jazz",
      candidateName: "Hotel Jazz",
      destination: "Barcelona",
      kind: "HOTEL",
    });
    expect(q(g!.url)).toBe("Hotel Jazz Barcelona");
  });

  it("doesn't repeat the city, and uses the leading place name", () => {
    const [g] = buildResearchLinks({ title: "Lisbon food tour", destination: "Lisbon, Portugal" });
    expect(q(g!.url)).toBe("Lisbon food tour");
  });

  it("skips flights and routine logistics", () => {
    expect(buildResearchLinks({ title: "Flight from Chicago to Lisbon", kind: "FLIGHT" })).toEqual([]);
    expect(buildResearchLinks({ title: "Check out of guesthouse", destination: "Porto" })).toEqual([]);
    expect(buildResearchLinks({ title: "Check in to budget guesthouse", destination: "Porto" })).toEqual([]);
    expect(buildResearchLinks({ title: "Airport transfer", destination: "Rome" })).toEqual([]);
  });

  it("still covers casual food and sights, which is where Reddit tips are most useful", () => {
    expect(buildResearchLinks({ title: "Breakfast at a local pastelaria", destination: "Lisbon" })).toHaveLength(2);
  });

  it("returns nothing for an empty subject and only https links to the two sites", () => {
    expect(buildResearchLinks({ title: "  " })).toEqual([]);
    for (const l of buildResearchLinks({ title: "A&B <x>", destination: "Q&A" })) {
      expect(["www.google.com", "www.reddit.com"]).toContain(new URL(l.url).host);
      expect(new URL(l.url).protocol).toBe("https:");
    }
  });
});

describe("simplifyTitle", () => {
  it.each([
    ["Self-guided visit to Castelo de São Jorge viewpoints", "Castelo de São Jorge viewpoints"],
    ["Browse Mercado da Ribeira (Time Out Market) and Feira da Ladra if open", "Mercado da Ribeira and Feira da Ladra"],
    ["Evening stroll through Alfama's alleys", "Alfama's alleys"],
    ["Free walking tour of Lisbon's historic centre", "Lisbon's historic centre"],
    ["Explore Park Güell", "Park Güell"],
    ["Casual dinner at a local tasca", "Casual dinner at a local tasca"],
    ["Low-key fado dinner in Alfama", "Low-key fado dinner in Alfama"],
  ])("%s -> %s", (input, expected) => {
    expect(simplifyTitle(input)).toBe(expected);
  });

  it("never strips a title to nothing", () => {
    expect(simplifyTitle("Explore")).toBe("Explore");
  });
});
