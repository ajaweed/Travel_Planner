// Whether "let the AI book it" can actually book anything right now, so the
// UI can say so honestly instead of offering a button that silently fails.
//
// Mirrors the env vars the adapters in packages/integrations read. "live"
// means every provider has credentials AND is pointed at production; anything
// less is sandbox/test at best, where nothing real gets booked or charged.

export type ProviderReadiness = {
  provider: "flights" | "hotels" | "tours" | "payments";
  configured: boolean;
  mode: "sandbox" | "production";
};

export type AiBookingReadiness = {
  /** Every provider configured and in production: real bookings, real charges. */
  live: boolean;
  /** At least one provider has credentials (sandbox or production). */
  anyConfigured: boolean;
  providers: ProviderReadiness[];
};

const has = (v: string | undefined) => !!v && v.trim().length > 0;

export function getAiBookingReadiness(env: NodeJS.ProcessEnv = process.env): AiBookingReadiness {
  const providers: ProviderReadiness[] = [
    {
      provider: "flights",
      configured: has(env.AMADEUS_CLIENT_ID) && has(env.AMADEUS_CLIENT_SECRET),
      mode: env.AMADEUS_ENV === "production" ? "production" : "sandbox",
    },
    {
      provider: "hotels",
      configured: has(env.HOTEL_PROVIDER_CLIENT_ID) && has(env.HOTEL_PROVIDER_CLIENT_SECRET),
      mode: env.HOTEL_PROVIDER_ENV === "production" ? "production" : "sandbox",
    },
    {
      provider: "tours",
      configured: has(env.VIATOR_API_KEY),
      mode: env.VIATOR_ENV === "production" ? "production" : "sandbox",
    },
    {
      provider: "payments",
      configured: has(env.STRIPE_SECRET_KEY),
      mode: env.STRIPE_ENV === "live" ? "production" : "sandbox",
    },
  ];
  return {
    live: providers.every((p) => p.configured && p.mode === "production"),
    anyConfigured: providers.some((p) => p.configured),
    providers,
  };
}
