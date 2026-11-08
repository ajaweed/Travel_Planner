import { describe, expect, it } from "vitest";
import { getAiBookingReadiness } from "./aiBookingReadiness";

const allProd = {
  AMADEUS_CLIENT_ID: "a", AMADEUS_CLIENT_SECRET: "b", AMADEUS_ENV: "production",
  HOTEL_PROVIDER_CLIENT_ID: "c", HOTEL_PROVIDER_CLIENT_SECRET: "d", HOTEL_PROVIDER_ENV: "production",
  VIATOR_API_KEY: "e", VIATOR_ENV: "production",
  STRIPE_SECRET_KEY: "sk_live_f", STRIPE_ENV: "live",
};

describe("getAiBookingReadiness", () => {
  it("is not live and not configured with no keys (this repo's default)", () => {
    const r = getAiBookingReadiness({ AMADEUS_ENV: "sandbox", AMADEUS_CLIENT_ID: "" });
    expect(r.live).toBe(false);
    expect(r.anyConfigured).toBe(false);
  });

  it("is live only when every provider has keys and is in production", () => {
    expect(getAiBookingReadiness(allProd).live).toBe(true);
    expect(getAiBookingReadiness({ ...allProd, STRIPE_ENV: "test" }).live).toBe(false);
    // Stripe "live" with a test key is not production (payments.ts refuses it).
    expect(getAiBookingReadiness({ ...allProd, STRIPE_SECRET_KEY: "sk_test_x" }).live).toBe(false);
    expect(getAiBookingReadiness({ ...allProd, VIATOR_API_KEY: " " }).live).toBe(false);
  });

  it("reports sandbox keys as configured but not live", () => {
    const r = getAiBookingReadiness({ AMADEUS_CLIENT_ID: "a", AMADEUS_CLIENT_SECRET: "b" });
    expect(r.anyConfigured).toBe(true);
    expect(r.live).toBe(false);
    expect(r.anyLive).toBe(false);
    expect(r.providers.find((p) => p.provider === "flights")).toEqual({
      provider: "flights", configured: true, mode: "sandbox",
    });
  });
});

describe("partial production", () => {
  it("flags anyLive when some providers are live even though not all are", () => {
    const r = getAiBookingReadiness({ AMADEUS_CLIENT_ID: "a", AMADEUS_CLIENT_SECRET: "b", AMADEUS_ENV: "production" });
    expect(r.live).toBe(false);
    expect(r.anyLive).toBe(true);
  });
});
