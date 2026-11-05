# Team log

Append-only. See `docs/team-workflow.md` for the convention. Newest at the bottom.

---

**2026-11-05 -- architect** -- Initial scaffold: agent orchestration (Concierge →
Itinerary → Booking → Budget → Notification), provider adapters (Amadeus/Viator/Stripe),
Next.js UI, Prisma schema. Branch: none (initial commit direct to main, pre-dates this
workflow doc). Handoff: all roles, this is the baseline everyone builds on.

**2026-11-05 -- devops** -- Upgraded local Node 16.15.1 → 26.13.0 (Next.js 14 requires
18.18+); confirmed `npm run build -w apps/web` and `npm run typecheck` pass. Handoff:
none blocked on this anymore.

**2026-11-05 -- integrations-dev** -- Researched real production-access requirements for
Amadeus/Viator/hotel providers/Stripe; wrote `docs/going-live.md`. Recommended Expedia
Rapid API over Amadeus Hotel Booking / Booking.com Demand for hotels (Booking.com's terms
require prior written approval to use AI at all -- a direct blocker for this product).
Handoff: whoever picks up a real hotel integration should start from that file, not
re-research from scratch.

**2026-11-05 -- backend-dev** -- Live-tested the full pipeline against real Claude calls
and found three bugs the design review didn't catch: (1) Claude occasionally
double-encodes a complex tool-call field as a JSON string instead of a native array --
added `toolInputRepair.ts` to detect and unwrap this before validation; (2) flight
booking had no required origin city or concrete date to search with -- ConciergeAgent now
treats both as blocking when flights are needed; (3) ItineraryAgent was marking dinners
bookable as `RESERVATION` with no backing tool, and double-booking the hotel (check-in
*and* check-out as separate bookings) -- fixed both. Handoff: qa-tester should add
regression coverage for the double-encoding repair path specifically, since that's the
kind of thing that only shows up against the real model, not in a schema review.

**2026-11-05 -- architect / ux-designer** -- Added `ux-designer` to the team and this
workflow doc. Next up (separate branches, sequential -- both touch
`packages/core/src/orchestrator.ts` and the trip dashboard page): (1) multiple itinerary
options with real review data pulled in to inform the comparison, (2) a persistent
"revise this trip" prompt on the dashboard. Multi-option work goes first since it changes
the planning flow more fundamentally; the revision-prompt work builds on top of it.
