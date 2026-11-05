# Architecture

## Flow

```mermaid
sequenceDiagram
    participant U as User
    participant W as apps/web
    participant O as Orchestrator (packages/core)
    participant C as ConciergeAgent
    participant I as ItineraryAgent
    participant B as BookingAgent
    participant Bu as BudgetAgent
    participant P as Providers (Amadeus/Viator/Stripe)
    participant R as Reviews (Google Places, read-only)
    participant N as NotificationAgent

    U->>W: "Relaxed week somewhere warm, ~$2000"
    W->>O: startTrip(prompt)
    O->>C: extract TripBrief
    alt missing required info
        C-->>O: needs_clarification
        O->>N: notify(CLARIFICATION_NEEDED)
        N-->>U: shown in-app
        U->>W: answers
        W->>O: answerClarification()
    end
    loop each option variant (value / balanced / elevated), in parallel
        O->>I: build itinerary from TripBrief + variant framing
        I-->>O: day-by-day plan + bookable placeholders + candidate place names
    end
    O->>R: lookupPlaceReviews(each named HOTEL/TOUR candidate)
    R-->>O: real rating / review count, or NOT_CONFIGURED / no match
    O->>N: notify(ITINERARY_READY)
    Note over O: trip status = CHOOSING; nothing booked yet
    U->>W: picks an option
    W->>O: selectItineraryOption(tripId, optionId)
    Note over O: CHOOSING -> BOOKING is a conditional update (double-click lock)
    loop each bookable item, sequentially
        O->>Bu: getBudgetStatus(trip)
        O->>B: search + book this item
        B->>P: search_*, check_budget_ok, book_*
        alt would exceed budget
            B-->>O: AWAITING_CONFIRMATION
            O->>N: notify(BUDGET_ALERT)
        else booked
            B-->>O: BOOKED
            O->>Bu: recordBudgetEntry
            O->>N: notify(BOOKING_CONFIRMED)
        else provider failure
            B-->>O: FAILED
            O->>N: notify(BOOKING_FAILED)
        end
    end
```

## Package boundaries

- `apps/web` — UI + thin API routes. Only ever calls `packages/core`.
- `packages/core` — agents + orchestrator. The only package that talks to the LLM
  (Anthropic SDK) and the only package that sequences money-moving operations.
- `packages/integrations` — the only package that holds provider SDKs/API keys and
  knows a real HTTP endpoint exists. Exposes a provider-agnostic `ProviderResult<T>`
  discriminated union so `packages/core` never has to special-case a specific vendor.
- `packages/db` — Prisma schema, single source of truth for domain entities.

## Decisions log

| Decision | Choice | Why |
|---|---|---|
| Flights provider | Amadeus for Developers | Free sandbox, well-documented, same OAuth2 client-credentials flow reusable for hotels. Production flight *booking* needs their separate Enterprise "Flight Create Orders" agreement. |
| Hotels provider | Amadeus Hotel Booking API (pluggable) | Reuses the Amadeus client for day-one simplicity. `packages/integrations/src/hotels.ts` is written against a `HotelProviderAdapter` interface so swapping to Expedia Rapid API or Booking.com Demand API later is a new adapter + one env var, not a rewrite. |
| Tours provider | Viator Partner API | Broadest activity inventory with a documented partner program and a real sandbox. |
| Reviews/ratings provider | Google Places API (New) | Needed real signal on the named hotels/tours in the itinerary-options comparison view. Chosen because it's the only candidate that's genuinely self-serve — a standard Google Cloud API key with "Places API (New)" enabled, no partner/affiliate agreement — unlike every booking provider here. Read-only: `packages/integrations/src/reviews.ts` is never called from BookingAgent and cannot spend money. It is also the one adapter with no sandbox/production switch, because Google publishes no sandbox environment for Places (documented in the file header). |
| Multiple itinerary options | 2-3 options via separate ItineraryAgent calls, one per variant framing | The user picks before anything is booked (new `CHOOSING` trip status + `ItineraryOption` rows). Separate calls rather than one call returning all variants: the single-itinerary tool schema is the shape already proven against the real model, and asking for 3x the output in one call triples the truncation surface at `max_tokens` while losing per-variant retry. `Promise.allSettled`, so one bad variant costs one option instead of the trip. |
| Payments | Stripe | PCI scope stays off our servers via Payment Element/PaymentIntents; this codebase never touches raw card data. |
| Messaging channel | In-app only (current scope) | Chosen explicitly over email/SMS/Slack for v1 — `packages/core/src/agents/notificationAgent.ts` is the one seam to add a channel later without touching callers. |
| Auth | **Not yet implemented** | `/api/plan` currently runs every request against a single demo user (see the NOTE in `apps/web/app/api/plan/route.ts`). Needs real session-based auth before this is usable by more than one person or anywhere near real payments. |

## What "production" actually requires, per provider

None of these go live just by setting an env var to `production`/`live` — each needs a
business-side step first, which is why every adapter defaults to sandbox/test and
refuses to run in production mode until that's done:

- **Amadeus (flights)**: sandbox keys are self-serve. Production *flight orders*
  specifically require Amadeus's Enterprise agreement — a sales/approval process.
- **Hotel provider** (Amadeus/Expedia/Booking.com): all three require a signed
  partner/affiliate agreement before issuing production credentials.
- **Viator (tours)**: sandbox keys are self-serve; production booking access requires
  partner approval and an integration review.
- **Stripe (payments)**: requires completing business/identity verification
  ("Activate your account") before live secret keys will process real charges.
- **Google Places (reviews)** is the exception to the paragraph above: it needs no
  business agreement at all, just a Google Cloud API key with "Places API (New)"
  enabled, and it has no sandbox mode to gate because Google publishes none. That's
  only acceptable because it is read-only and cannot commit money — any future adapter
  that can spend needs the sandbox gate. It is billed per request, so set a quota cap.

See `docs/going-live.md` for the researched specifics per provider — real application
URLs, concrete requirements, costs, realistic timelines (and where none is published),
and whether a solo/independent developer can realistically get approved for each. Short
version of that research's bottom line: Stripe and Viator's lower access tiers are
realistically solo-developer-obtainable; Amadeus flight *ticketing* effectively
requires a consolidator/IATA-ARC relationship; and of the three hotel options, Expedia
Rapid API is the most realistically obtainable for an independent developer (Amadeus's
enterprise sales motion and Booking.com's Managed-Affiliate gate are both harder, and
Booking.com's partner terms separately require written approval to use AI at all).

## Known gaps (explicitly out of scope for this pass)

- Real user authentication/sessions.
- Cancellation/refund flows in the UI (the `refundPayment` adapter exists; nothing
  calls it yet).
- Streaming/SSE for trip updates — the dashboard currently polls every 4s.
- `ItineraryOption.estimatedTotalCents` is the *model's* estimate, shown to the user
  explicitly labelled as an estimate. Nothing prices an option against real provider
  inventory before the user chooses it — the real prices still only arrive during the
  booking pass, so a chosen option can still turn out to breach budget.
- Multi-city itineraries beyond a single destination list (the schema supports an
  array of destinations; ItineraryAgent prompting for multi-leg trips needs testing).
