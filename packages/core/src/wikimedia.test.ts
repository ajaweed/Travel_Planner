import { afterEach, describe, expect, it } from "vitest";
import { REQUESTS_PER_MINUTE, WIKIPEDIA_API, WikimediaUnavailable, setWikimediaFetch, userAgent, wikiQuery } from "./wikimedia";

afterEach(() => {
  setWikimediaFetch(null);
  delete process.env.WIKIMEDIA_CONTACT;
});

const ok = async () => ({ ok: true, status: 200, json: async () => ({ query: {} }) });

describe("wikiQuery", () => {
  it("identifies itself with contact info (Wikimedia's 200/min tier) and opts out of Next's fetch cache", async () => {
    let init: any;
    setWikimediaFetch(async (_u, i) => {
      init = i;
      return ok();
    });
    await wikiQuery(WIKIPEDIA_API, { titles: "Lisbon" });
    expect(init.headers["User-Agent"]).toBe("TripPlannerAI/0.1 (https://github.com/ajaweed/Travel_Planner) bot");
    expect(init.cache).toBe("no-store");
  });

  it("contact can be overridden", () => {
    process.env.WIKIMEDIA_CONTACT = "ops@example.org";
    expect(userAgent()).toBe("TripPlannerAI/0.1 (ops@example.org) bot");
  });

  it("never has more than 3 requests in flight", async () => {
    let inFlight = 0;
    let max = 0;
    setWikimediaFetch(async () => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return ok();
    });
    await Promise.all(Array.from({ length: 10 }, () => wikiQuery(WIKIPEDIA_API, {})));
    expect(max).toBe(3);
  });

  it("after a 429, fails fast without calling Wikimedia until Retry-After passes", async () => {
    let calls = 0;
    setWikimediaFetch(async () => {
      calls++;
      return { ok: false, status: 429, headers: { get: () => "120" }, json: async () => ({}) };
    });
    await expect(wikiQuery(WIKIPEDIA_API, {})).rejects.toBeInstanceOf(WikimediaUnavailable);
    await expect(wikiQuery(WIKIPEDIA_API, {})).rejects.toBeInstanceOf(WikimediaUnavailable);
    expect(calls).toBe(1);
  });

  it("network errors become WikimediaUnavailable", async () => {
    setWikimediaFetch(async () => {
      throw new Error("ECONNRESET");
    });
    await expect(wikiQuery(WIKIPEDIA_API, {})).rejects.toBeInstanceOf(WikimediaUnavailable);
  });

  it("keeps under the per-minute budget", async () => {
    let calls = 0;
    setWikimediaFetch(async () => {
      calls++;
      return ok();
    });
    const ctrl = new AbortController();
    const all = Array.from({ length: REQUESTS_PER_MINUTE + 3 }, () =>
      wikiQuery(WIKIPEDIA_API, {}, ctrl.signal).catch(() => "waited"),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(REQUESTS_PER_MINUTE);
    ctrl.abort(); // release the ones waiting for the window
    expect((await Promise.all(all)).filter((x) => x === "waited")).toHaveLength(3);
  });
});
