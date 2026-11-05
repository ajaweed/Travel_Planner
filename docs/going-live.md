# Going live: production API access, per provider

This is research, not a decision record — it documents what each provider's own
developer/partner documentation says is required to move from free self-serve sandbox
access to real production credentials that move real money or issue real bookings.
Nothing here signs up for anything; see `docs/architecture.md` for the short summary
and the project's actual provider decisions.

Researched November 2026, against each provider's current public documentation.
Where a provider doesn't publish a number (timeline, fee, volume threshold), that is
stated plainly below rather than guessed. Anecdotal figures (from developer blogs
rather than the provider's own docs) are labeled as such.

---

## 1. Amadeus for Developers (flights)

**Two separate things to go live on:** flight *search* (already works today on free
self-serve sandbox keys) and flight *order creation* (real ticketed bookings), which is
gated separately.

### Moving a self-service app to production (search, pricing, etc.)
- **Where**: sign in at `https://developers.amadeus.com/signin`, open
  "My Self-Service Workspace" → select your app → **Get Production environment**.
- **Requirements**: fill in personal information, billing address, and app details;
  declare whether you intend to use Flight Create Orders; choose a payment method
  (credit card or bank transfer); sign the Terms of Service via DocuSign.
- **Timeline**: Amadeus's own docs say first-time production validation "usually
  occurs within 72 hours"; later applications on the same account are validated
  automatically.
- **Cost**: no application fee; usage above a free monthly threshold is billed monthly
  per call. Exact rate card is account-specific.
- **Solo developer**: yes — this tier is explicitly self-service and does not require
  an incorporated business. This is enough to ship real flight *search* in production.

### Flight Create Orders (actually booking/ticketing a flight)
- **Where to start**: Amadeus Enterprise sales — `https://amadeus.com/en/contact/contact-sales`
  (general contact: `https://amadeus.com/en/contact`). There is no self-serve "apply"
  button; it starts as a sales conversation with an Amadeus consultant who scopes the
  commercial offer.
- **Hard requirement**: ticket issuance is restricted to IATA- (rest of world) or
  ARC- (US) accredited travel agencies. An independent app that is not itself
  IATA/ARC-accredited cannot issue a real ticket directly — it must contract with an
  airline **consolidator / host agency** that holds that accreditation and issues the
  ticket on the app's behalf, typically for a commission. Amadeus says it can help
  connect developers to a consolidator in their region, but the consolidator
  relationship is a separate deal that has to be negotiated on top of the Amadeus
  agreement itself.
- **Other requirements**: a signed commercial/Enterprise contract (pricing, revenue
  share where applicable, SLA for support, technical/security requirements), plus a
  demonstrated working integration (correct error handling, full booking flow) before
  Amadeus grants live Flight Create Orders access. Flight booking is also subject to
  local consumer-protection regulation — California and France are specifically flagged
  in Amadeus's own guidance as having extra requirements.
- **Timeline**: Amadeus does not publish a fixed SLA for Enterprise approval.
  Secondary sources (developer blogs, not Amadeus itself) describe the commercial
  agreement process taking roughly 4–12 weeks once started — treat that range as
  anecdotal, not an official figure.
- **Cost**: no published flat fee; Enterprise deals are commercially negotiated
  (segment fees / revenue share depending on the agreement), separate from whatever
  the consolidator charges for ticket issuance.
- **Solo developer**: realistically no, not without a consolidator partner. An
  individual or pre-incorporated developer can still build and demo the full flow
  against the sandbox indefinitely; actually issuing a live ticket requires either
  becoming IATA/ARC accredited (effectively requires being an established travel
  agency) or signing with a consolidator who is. This is the single biggest "requires
  an existing business relationship, not just paperwork" gate of the four providers.

---

## 2. Hotel provider — recommendation: pursue none of the three yet; if forced to pick one today, pick the **Expedia Rapid API path over Amadeus Hotel Booking or Booking.com Demand**, run as an affiliate/referral model first

All three require a signed partner agreement before production credentials are issued —
there is no self-serve production tier for any of them. Comparing the three on how
obtainable they are for an independent developer / small business (not a large OTA):

### Amadeus Hotel Booking API
- **Where**: same Enterprise sales funnel as flights —
  `https://amadeus.com/en/contact/contact-sales`.
- **Requirements**: full commercial Enterprise agreement (contract, pricing, SLA);
  Amadeus's enterprise tier is explicitly oriented at businesses with existing
  accreditation/scale (the IATA/ARC framing that applies to flights carries over to
  the sales motion, even though hotel bookings themselves don't need IATA/ARC). Amadeus
  requires a demonstrated, tested integration with correct error handling before
  granting live access.
  Self-service sandbox hotel search works today without any of this.
- **Timeline**: not published by Amadeus; developer-community estimates (anecdotal)
  put the enterprise contracting process at 4–12 weeks.
- **Cost**: no flat fee disclosed; negotiated commercial terms (volume-based, per
  Amadeus's own docs it depends on "usage, booking volume, services used, and
  commercial agreement").
- **Solo developer**: unlikely to get meaningful traction — this is the same
  high-touch enterprise sales motion as flights, generally aimed at travel businesses
  already operating at some scale, and Amadeus's own sales process is built around that
  (per the Enterprise-sales nature of the funnel, not a published minimum).

### Expedia Rapid API
- **Where**: `https://partner.expediagroup.com/en-us/join-us/rapid-api` (a
  "Contact us" / consultative intake form, not a self-service signup).
- **Requirements**: a partner application describing your business model, your
  website/existing solution, and your **projected booking volume**. Expedia's own
  developer docs are explicit that "all applications will be reviewed case by case"
  and that there is **no stated minimum sales/volume requirement** — they evaluate
  revenue/growth potential, existing traffic, and average bookings, but don't publish
  a hard cutoff. Before going live, Expedia requires passing documented per-vertical
  "launch requirements" (e.g. `developers.expediagroup.com/rapid/setup/launch-requirements`)
  and a **PCI Attestation of Compliance**; your Expedia business-development contact
  then performs a site/integration review before flipping your key to production.
- **Timeline**: not officially published. Anecdotal developer reports describe
  12–20 weeks end-to-end for a competent small engineering team, from first
  application to live production key — treat as anecdotal.
- **Cost**: no application fee disclosed publicly; commercial terms (net rates,
  margin/revenue share) are negotiated per partner and region, not published.
- **Solo developer**: plausible but not guaranteed — Expedia explicitly says there's
  no hard minimum, and the application is a business-case pitch rather than a legal-
  entity gate. A credible existing website/audience and a believable booking-volume
  story materially help; a bare idea with zero traffic is a weak application. This
  does not strictly require being incorporated, though a real business presence
  (working site, support contact, PCI-compliant payment handling) is unavoidable by
  the time you reach launch requirements.

### Booking.com Demand API
- **Where**: no public "apply" page for the Demand API itself. Access requires first
  becoming a **Managed Affiliate Partner** through Booking.com's partner org
  (`https://partnerships.booking.com/`), signing a contract, and then having your
  assigned Account Manager enable Partner Centre access, where API keys are issued.
  Prerequisites doc: `https://developers.booking.com/demand/docs/getting-started/prerequisites`.
- **Requirements**: an established, approvable online presence (a real website with
  clear navigation, About/Contact, privacy policy; a bare social-media-only profile
  is explicitly rejected per Booking.com partner guidance). The Demand API specifically
  sits behind the *Managed* Affiliate Partner tier, which is account-manager-gated —
  qualifying for it is a relationship-based/sales decision Booking.com doesn't fully
  publish criteria for. Separately, Booking.com's General Partner Terms (v5) require
  **prior written Booking.com approval before using AI** in performing the agreement —
  directly relevant to this project, since the whole point is an AI agent doing the
  booking.
- **Timeline**: not published anywhere in Booking.com's developer docs.
- **Cost**: not published; Demand API access rides on the affiliate commission
  structure rather than a flat fee, but the Managed-tier commercial terms aren't
  public.
- **Solo developer**: the hardest of the three to get into deliberately — "Demand
  API is not self-service," it requires Managed (not plain) Affiliate Partner status,
  an Account Manager relationship, and — specific to this project — written sign-off
  to use AI in fulfilling the agreement at all. There's no clear on-ramp for an
  individual developer without an existing commercial relationship with Booking.com.

### Recommendation
**Expedia Rapid API is the most realistically obtainable of the three for an
independent developer or small business**, specifically because:
1. It has a stated intake path with no disclosed hard minimum (volume, incorporation,
   or otherwise) — Expedia's own docs say applications are evaluated case-by-case on
   business case and growth potential, not gated behind an existing accreditation like
   Amadeus's IATA/ARC-flavored enterprise motion.
2. Unlike Booking.com, there's no explicit AI-use restriction surfaced in public docs,
   which matters directly for an AI-agent-driven booking product like this one.
3. Booking.com's Demand API is gated behind "Managed Affiliate Partner" status that
   Booking.com doesn't publish a path to for a new, unproven developer — it reads as
   effectively closed without a pre-existing relationship.

This is a relative ranking, not a green light: Expedia still requires passing launch
requirements (including a PCI Attestation of Compliance) and a BD-manager site review,
and the anecdotal 12–20 week timeline means this is a months-long process either way.
The pragmatic order of operations for this project: keep shipping against the Amadeus
Hotel sandbox (already working, zero business steps required) while separately opening
an Expedia partner application in parallel, since the review clock only starts once
you apply.

---

## 3. Viator Partner API (tours/activities)

- **Where**: start at the Viator Partner Resource Center,
  `https://partnerresources.viator.com/travel-commerce/` (choose Affiliate vs.
  Merchant API), or contact the API onboarding team directly at
  `affiliateapi@tripadvisor.com` with your endpoint usage plan before starting
  development.
- **Access is tiered, and the tiers matter a lot here**:
  - **Basic Access** — instant, self-service, no approval needed. Checkout still
    happens on viator.com, not your own site/app.
  - **Full Access** — richer data (reviews, photos, real-time availability, bulk
    catalog endpoints). Requires Viator approval *and* passing API certification
    before going live; checkout is still off-site on viator.com.
  - **Full + Booking Access** — the tier this project actually needs, since the goal
    is to book tours from inside the app. Requires approval **and** certification;
    this is what unlocks in-app checkout via Viator's payment solution and
    booking/cancellation management.
- **Certification requirements**: Viator requires your product-ingestion and
  availability-sync strategy to be reviewed and verified before you're allowed onto
  the production server — explicitly described as confirming your implementation is
  "optimized" and meets minimum data-integrity criteria, since the API grants
  transactional access to live inventory.
- **Cost**: the **Affiliate API** has no signup cost and no cost for additional API
  access. The **Merchant API** (closer to Full+Booking) has no setup fee, but Viator
  requires a **deposit before going live**, sized to your expected sales volume and
  confirmed during qualification — i.e., there is a cash requirement, just not a
  published flat number.
- **Commission structure**: Viator's standard public affiliate commission is 8% on
  completed bookings; API/B2B partner agreements are reported (anecdotally, not from
  Viator's own published rate card) in the 20–25% base range — confirm actual terms in
  your own Partner Dashboard/contract rather than relying on either figure.
- **Timeline**: not published by Viator. No credible anecdotal figure found either —
  stating that plainly rather than guessing.
- **Solo developer**: yes for Basic Access (today, no approval). For Full + Booking
  (what real in-app booking needs), approval + certification is required but nothing
  in Viator's public docs says it's restricted to incorporated businesses — the gate
  is technical/data-quality certification and a sales-volume-sized deposit, not a
  legal-entity requirement. This is the most individually-approachable of the two
  booking-capable providers researched here (compare to the hotel options above).

---

## 4. Stripe (payments)

- **Where**: `https://dashboard.stripe.com/register` to create an account, then
  `https://dashboard.stripe.com/account/onboarding` to verify the business and
  activate live mode. Reference: `https://docs.stripe.com/get-started/account/set-up`.
- **Requirements** (Stripe's "Know Your Customer" obligations): legal business name
  and entity type, registered business address, business tax ID (or, for a sole
  proprietor, the equivalent individual tax ID), the responsible person's legal name/
  date of birth/last-4 SSN (or local equivalent), a live website URL describing the
  product, support contact details (email, phone, address) that will appear on
  customer statements/receipts, and a bank account located in the same country as the
  registered business for payouts.
- **Timeline**: Stripe does not commit to a fixed SLA. Commonly reported guidance
  (including from Stripe-adjacent integrator write-ups, treat as anecdotal) is to
  submit verification "a few days" before launch since Stripe can request additional
  documents, with review sometimes taking "up to a week." Most individual/sole-
  proprietor accounts with clean documentation are reported to activate much faster
  (same day to a few days) — anecdotal, not an official number.
- **Cost**: no fee to create or verify an account. Stripe's revenue comes from
  per-transaction processing fees (standard published rate: 2.9% + $0.30 per
  successful US card charge at the time of writing), not an activation fee.
- **Solo developer**: yes — Stripe explicitly supports sole proprietors/individuals,
  not just incorporated entities, as a business type during onboarding. A solo
  developer can realistically self-serve through verification without a lawyer or a
  formal corporation, provided they can supply a real individual tax ID, a real bank
  account, and a live website describing what they're charging for. This is the
  easiest "get to real production" path of the four providers, with the important
  caveat that it only covers *collecting payment* — the underlying booking still has
  to actually succeed with the flight/hotel/tour provider, which is where the other
  three sections above are the real bottleneck.

---

## Summary table

| Provider | Self-serve production start point | Hard gate | Solo developer realistic? |
|---|---|---|---|
| Amadeus — search | `developers.amadeus.com` → My Self-Service Workspace | None (self-serve, ~72h) | Yes |
| Amadeus — Flight Create Orders | Enterprise sales (`amadeus.com/en/contact/contact-sales`) | IATA/ARC accreditation or a consolidator relationship | No, not without a consolidator |
| Hotels — Amadeus / Expedia / Booking.com | No self-serve production tier for any of the three | Signed partner agreement in all three cases | Expedia most plausible; Booking.com least |
| Viator — Full + Booking Access | `partnerresources.viator.com` / `affiliateapi@tripadvisor.com` | API certification + volume-sized deposit | Yes, with certification effort |
| Stripe | `dashboard.stripe.com/register` → onboarding | Business/identity (KYC) verification | Yes, sole proprietor supported |
