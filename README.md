# Trip Planner AI

Tell it what kind of trip you want — specific or "I don't know, surprise me" — and a
pipeline of backend AI agents turns that into a few genuinely different day-by-day
itineraries to choose between, then searches and books flights/hotels/tours against real
provider APIs for the one you pick, tracks it all against your budget, and raises in-app
notifications as things happen.

See `docs/architecture.md` for the full flow diagram, package boundaries, and a decisions
log of which provider was picked for what and why.

## Status

This is a working scaffold, not a finished, live-bookable product:

- The agent pipeline (Concierge → Itinerary → Booking → Budget → Notification) is fully
  wired and runs real tool-use loops against Claude.
- Planning is two-stage: you get 2-3 itinerary options (value / balanced / elevated) with
  estimated costs to compare, and nothing is booked until you choose one. Where an option
  names a specific hotel or tour, its **real** Google rating and review count are shown —
  and where they can't be looked up, it says "no rating available" rather than inventing
  a number.
- Flight/hotel/tour/payment adapters are written against real provider APIs
  (Amadeus, Viator, Stripe) and run in **sandbox/test mode only**. Flipping any of them
  to production requires completing that provider's business approval process first —
  see "Going to production" below. Until then, bookings will come back as
  `NOT_CONFIGURED` or sandbox-only results, by design, not as a bug.
- There is no real user auth yet — every request currently plans a trip for one demo
  user (see the NOTE in `apps/web/app/api/plan/route.ts`).

## Requirements

- **Node.js 18.18+** (Next.js App Router requirement). This machine currently has
  **Node 16.15.1** installed, which will not run this app — install a newer Node first,
  e.g. via [nvm-windows](https://github.com/coreybutler/nvm-windows):
  ```
  nvm install 20.17.0
  nvm use 20.17.0
  ```
- An [Anthropic API key](https://console.anthropic.com) — required even in sandbox
  mode, since the agents themselves call Claude.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in ANTHROPIC_API_KEY at minimum
npm run db:generate
npm run db:migrate           # creates packages/db/prisma/dev.db (SQLite)
npm run dev
```

Open http://localhost:3000, describe a trip, and watch `/trip/[id]` update as the agents
plan and (attempt to) book it.

## Going to production (per provider)

Sandbox credentials are self-serve for all four *booking/payment* providers;
**production credentials are not** — each requires a business-side approval step first.
(Google Places, used only for read-only ratings, is the exception: see the last row.) `.env.example` documents the
exact env vars; `docs/architecture.md` has the full table. Short version:

| Provider | What's needed before `*_ENV=production` / `live` will actually work |
|---|---|
| Amadeus (flights) | Enterprise "Flight Create Orders" agreement for booking (search works on sandbox keys already) |
| Hotel provider | Signed partner/affiliate agreement (Amadeus Hotel Booking / Expedia Rapid / Booking.com Demand — pick one) |
| Viator (tours) | Partner approval + integration review for production booking |
| Stripe (payments) | Business/identity verification ("Activate your account") |
| Google Places (ratings) | Nothing to approve — just a Google Cloud API key with "Places API (New)" enabled and billing on. Read-only, never books anything. Billed per request, so set a quota cap. |

The adapters in `packages/integrations` will actively refuse to run in production mode
until you've done this — that's deliberate, not a bug to work around. For the
researched specifics per provider (real application URLs, concrete requirements,
costs, realistic timelines, and whether a solo developer can realistically get
approved), see `docs/going-live.md`.

## The "dev team"

`.claude/agents/` defines a Claude Code subagent per role — `architect`, `backend-dev`,
`integrations-dev`, `frontend-dev`, `ux-designer`, `qa-tester`, `devops`. Claude Code will
route to the right one automatically based on what you ask for (e.g. "wire up Expedia for
hotels" → `integrations-dev`), or you can call one by name.

They coordinate through the repo, not a live chat — see `docs/team-workflow.md` for the
branch/code-review/merge convention and `docs/team-log.md` for the running record of who
did what and why. That log is also the real communication channel between agents: since
each is invoked fresh per task with no shared memory, the log and `docs/architecture.md`
are how one agent's work stays visible to the next.

## Repo layout

```
apps/web                  Next.js UI + API routes
packages/core             Agent orchestration (Concierge/Itinerary/Booking/Budget/Notification)
packages/integrations     Provider adapters (Amadeus, Viator, Stripe)
packages/db               Prisma schema (Trip, Itinerary, Booking, BudgetEntry, Notification)
docs/architecture.md      Flow diagram, decisions log, known gaps
.claude/agents/           Claude Code dev-team subagent definitions
```
