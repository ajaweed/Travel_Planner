# Visual design spec: "Golden Hour"

Owner: `ux-designer`. Implementer: `frontend-dev`. Status: spec only. No app code has
changed yet. Supersedes the current dark-neutral styling in `apps/web` (`#0b0f14`
background, `neutral-*` grays throughout), which the product owner called "so bland".

This doc tells you what to build, with exact values. Flow and copy commitments from
`.claude/agents/ux-designer.md` and the options spec in `docs/team-log.md` still apply.
Where this doc and those conflict, the commitments win.

> **Product change, 2026-11-08: the app no longer books anything.** Each bookable item
> (flight, hotel, tour/event) instead gets a **"Book it yourself"** link. The link is a
> deterministic provider search URL built from the item's own details (dates,
> origin/destination, place name). The model never writes these URLs. This spec reflects
> that change:
> - No booking-progress or booking-status states (SEARCHING/BOOKED/FAILED/AWAITING_CONFIRMATION).
> - No payment UI.
> - No "provider not configured" booking states.
> - Budget figures are **estimates only**, since we never see real prices.
>
> The link-out pattern is §4.7. backend-dev is building the data side on `main`, so field
> names below are described by meaning. Wire them to whatever shape lands.

---

## 1. Direction and why

**Golden Hour: a warm, light, editorial look, like a good travel magazine printed on
sand-colored paper, with a deep-lagoon brand color for anything you click or trust.**

- **Warm and inviting.** The page is a warm off-white (`sand-50`), not a gray, and the
  hero sits under a soft sunrise gradient (peach to lagoon tint). Headings use a soft,
  characterful serif (Fraunces). The app stops looking like a dev tool and starts looking
  like somewhere to go.
- **Aspirational, without stock photos.** Gradients and an original contour-line pattern
  (map topography) do the work photography usually does. We hold no image rights, and a
  photo of the wrong beach is a small lie anyway (see §3).
- **Trustworthy, because people spend real money on what it tells them.** We don't take
  payment, but users go book flights and hotels based on our plan and our cost
  estimates. Everything you can act on (buttons, links,
  focus rings, progress) uses one sober color, lagoon teal `#0E6B66`. Money figures use
  a tabular sans (Inter `tabular-nums`) and are never set in the decorative serif.
  Status colors mean one thing each and always come with an icon and a word, never
  color alone. Restraint is part of looking trustworthy: one accent color, generous
  whitespace, no glassmorphism, no confetti.
- **Why light rather than a nicer dark theme.** Travel products signal daylight and
  openness. The current dark UI with neutral grays is a big part of what reads as
  "bland/technical". Dark mode is explicitly out of scope for this pass (§7).

---

## 2. Tokens (Tailwind-ready)

### 2.1 Colors

Drop-in for `apps/web/tailwind.config.js` → `theme.extend.colors`:

```js
colors: {
  sand:   { 50: "#FBF7F1", 100: "#F5EEE3", 200: "#EADFCF", 300: "#D9CAB3", 400: "#9A8A73" },
  ink:    { 900: "#1F2A33", 700: "#3D4B57", 500: "#5E6B76" },
  lagoon: { 50: "#E2F0EE", 600: "#0E6B66", 700: "#0A5652" },
  sunset: { 50: "#FDF0E6", 600: "#B4502C" },
  // Option tiers (comparison cards only)
  value:    { 50: "#E7F1E5", 600: "#2F6B3E" },
  balanced: { 50: "#E5EEF7", 600: "#2B5C8A" },
  elevated: { 50: "#F4E9F2", 600: "#6C3A6E" },
  // Semantic status
  success: { 50: "#E6F4EA", 700: "#1E6B3C" },
  warning: { 50: "#FDF3E1", 700: "#8A5300" },
  danger:  { 50: "#FDECEA", 700: "#B42318" },
  info:    { 50: "#E5EEF7", 700: "#2B5C8A" },
},
```

| Token | Hex | Role |
|---|---|---|
| `sand-50` | `#FBF7F1` | Page background |
| `white` | `#FFFFFF` | Cards, prompt box, inputs |
| `sand-100` | `#F5EEE3` | Chips, subtle fills, budget track, skeletons |
| `sand-200` | `#EADFCF` | Card borders, dividers (decorative only) |
| `sand-300` | `#D9CAB3` | Timeline rail, stronger dividers (decorative only) |
| `sand-400` | `#9A8A73` | **Input/textarea borders**: meets the 3:1 non-text contrast rule |
| `ink-900` | `#1F2A33` | Primary text, headings |
| `ink-700` | `#3D4B57` | Secondary text, body copy in cards |
| `ink-500` | `#5E6B76` | Muted text: captions, "est. total", honesty notes |
| `lagoon-600` | `#0E6B66` | Primary buttons, links (incl. "Book it yourself" link text), focus ring, budget estimate stripes |
| `lagoon-700` | `#0A5652` | Primary hover/active; text on `lagoon-50` |
| `lagoon-50` | `#E2F0EE` | Selected/hover tint, info-ish highlight |
| `sunset-600` | `#B4502C` | Brand accent: hero accent word, clarification accent bar, decorative icons. Not for buttons (too close to danger). |
| `sunset-50` | `#FDF0E6` | Clarification card background |
| `value-*` / `balanced-*` / `elevated-*` | see above | Option tier identity (§4.3) |
| `success/warning/danger/info` | see above | Status pills, alerts, notifications |

**Measured contrast (WCAG 2.x formula; AA = 4.5:1 for body text, 3:1 for large text and UI
components):**

| Foreground / background | Ratio | Use |
|---|---|---|
| ink-900 / sand-50 | 13.69 | body |
| ink-900 / white | 14.61 | body |
| ink-700 / sand-50 | 8.40 | secondary |
| ink-700 / sand-100 | 7.78 | chip text |
| ink-500 / white | 5.47 | muted |
| ink-500 / sand-50 | 5.12 | muted |
| ink-500 / sand-100 | 4.74 | muted on chips (passes, barely) |
| white / lagoon-600 | 6.34 | primary button |
| white / lagoon-700 | 8.52 | primary hover |
| lagoon-600 / white | 6.34 | links |
| lagoon-700 / lagoon-50 | 7.27 | selected-state text |
| sunset-600 / sand-50 | 4.77 | accent text |
| value-600 / value-50 | 5.50 | tier header |
| balanced-600 / balanced-50 | 5.97 | tier header |
| elevated-600 / elevated-50 | 7.21 | tier header |
| success-700 / success-50 | 5.74 | pill |
| warning-700 / warning-50 | 5.75 | pill/alert |
| danger-700 / danger-50 | 5.75 | pill/alert |
| danger-700 / white | 6.57 | inline error text |
| sand-400 / white | 3.36 | input border (non-text, ≥3:1) |

**Don'ts that came out of those numbers:**
- **Never put `ink-500` on `sand-200`** (4.15, fails). Muted text goes on white, `sand-50` or `sand-100` only.
- `sand-200`/`sand-300` borders are 1.6:1. That's fine for decorative card edges, but
  **not for input borders**, which must use `sand-400`.
- `sunset-600` passes at 4.77 for text, but keep it to accents and large text. It is not
  a CTA color.
- `value-600` (`#2F6B3E`) and `success-700` (`#1E6B3C`) are close. That's acceptable
  because tier cards (CHOOSING) and the success-green "Plan ready" pill and checklist
  ticks (after choosing) are never on screen together, and both always carry an icon and a label.

### 2.2 Typography (next/font)

```ts
// apps/web/app/fonts.ts
import { Fraunces, Inter } from "next/font/google";
export const display = Fraunces({
  subsets: ["latin"], axes: ["opsz", "SOFT"], variable: "--font-display", display: "swap",
});
export const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
```

`layout.tsx`: `<html lang="en" className={`${display.variable} ${sans.variable}`}>`,
`<body className="min-h-screen bg-sand-50 font-sans text-ink-900 antialiased">`.

Tailwind: `fontFamily: { display: ["var(--font-display)", "Georgia", "serif"], sans: ["var(--font-sans)", "system-ui", "sans-serif"] }`.

- **Fraunces** (display): page titles, hero, option labels, section headings, day
  numbers. Weight 500–600. In CSS set `font-variation-settings: "SOFT" 50, "opsz" 72` on
  `.font-display` (in `globals.css` under `@layer base`) for the softer, warmer cut.
- **Inter** (UI/body): everything else. **All money, counts and dates use
  `tabular-nums`.** Money is never set in Fraunces.

| Name | Tailwind class | Size / line-height | Font / weight | Used for |
|---|---|---|---|---|
| display | `text-5xl md:text-6xl` | 48/1.05 → 60/1.05, `tracking-tight` | Fraunces 500 | Landing hero H1 |
| h1 | `text-4xl` | 36/1.1, `tracking-tight` | Fraunces 600 | Trip title |
| h2 | `text-2xl` | 24/1.2 | Fraunces 600 | Section headings ("3 ways to do this trip") |
| h3 | `text-xl` | 20/1.25 | Fraunces 600 | Option label, day heading |
| price | `text-3xl font-semibold tabular-nums` | 30/1.1 | Inter 600 | Option total, budget total |
| body-lg | `text-lg` | 18/1.6 | Inter 400 | Hero subhead, prompt textarea |
| body | `text-base` | 16/1.6 | Inter 400 | Default |
| small | `text-sm` | 14/1.5 | Inter 400/500 | Card body, notes |
| caption | `text-xs` | 12/1.4 | Inter 500 | Pills, meta, footnotes |
| eyebrow | `text-xs font-semibold uppercase tracking-[0.12em]` | 12 | Inter 600 | Tier names, section kickers |

Minimum body size on cards is `text-sm` (14px). The honesty notes ("No rating
available", review-lookup notes) go **up from `text-xs` to `text-sm`**. They're
load-bearing, so they shouldn't be the hardest text on the page to read.

### 2.3 Spacing, radius, shadow

- Spacing: Tailwind's default 4px scale. Page gutters `px-6 md:px-8`. Vertical rhythm
  between page sections is `mt-12`. Inside a card it's `p-5 md:p-6`, with `gap-4` between
  blocks. Containers: landing `max-w-3xl`, trip dashboard `max-w-5xl` (unchanged).
- Radius (`theme.extend.borderRadius`): use `rounded-full` for chips and pills,
  `rounded-xl` (12px) for buttons and inputs, `rounded-2xl` (16px) for cards, and add
  `"3xl": "1.5rem"` for the prompt box and hero card.
- Shadows (`theme.extend.boxShadow`). They're tinted warm, never neutral black:
  ```js
  boxShadow: {
    card: "0 1px 2px rgba(31,42,51,0.04), 0 2px 8px rgba(31,42,51,0.05)",
    lift: "0 2px 4px rgba(31,42,51,0.05), 0 12px 32px -8px rgba(31,42,51,0.14)",
    dock: "0 -8px 24px -12px rgba(31,42,51,0.18)",
  }
  ```
  Use `card` for resting cards, `lift` for the prompt box, hovered option cards and the
  hero card, and `dock` for the persistent revise bar.
- Background images (`theme.extend.backgroundImage`):
  ```js
  backgroundImage: {
    sunrise: "radial-gradient(1200px 600px at 10% -10%, #FDE3C8 0%, rgba(253,227,200,0) 60%), radial-gradient(900px 500px at 100% 0%, #D7ECE8 0%, rgba(215,236,232,0) 55%)",
    "estimate-stripes": "repeating-linear-gradient(135deg, rgba(14,107,102,0.45) 0 6px, rgba(14,107,102,0.25) 6px 12px)",
  }
  ```

### 2.4 Motion

There are two rules. Motion exists to explain state changes, and every animation is
gated on `motion-safe:`.

- Durations: 150ms for hover/press color changes, 200ms for card lift and focus, and
  300ms for content entering. Easing: `ease-out` (`cubic-bezier(0.2, 0.8, 0.2, 1)` if you
  add a custom `transitionTimingFunction.out-soft`).
- Allowed:
  - Card hover lift: `motion-safe:transition motion-safe:hover:-translate-y-0.5 hover:shadow-lift`.
  - Button press: `active:scale-[0.98]` (motion-safe).
  - Content entering, such as options replacing skeletons or a new notification:
    fade + 4px rise, 300ms, staggered 60ms per card max.
  - In-progress indicators: `motion-safe:animate-spin` on `Loader2`, and
    `motion-safe:animate-pulse` on skeletons and on the live status dot.
  - Budget bar width change: `transition-[width] duration-500`.
- Not allowed: parallax, auto-playing carousels, confetti (people are about to spend real
  money on this plan, so calm is the point), animating the gradient background, bounce easing.
- `prefers-reduced-motion: reduce`: there is no spin, pulse, lift or rise. State changes
  are still visible through text and icon changes, and **every in-progress state also has
  text** ("Drafting your options…"), so nothing relies on animation to communicate. Add to `globals.css`:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
  }
  ```

### 2.5 Shared primitives

frontend-dev should build these once and reuse them. Plain components in
`apps/web/app/components/ui/` will do. No component library is needed.

| Primitive | Classes |
|---|---|
| `Button` primary | `inline-flex items-center justify-center gap-2 rounded-xl bg-lagoon-600 px-5 py-3 text-sm font-semibold text-white shadow-card hover:bg-lagoon-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lagoon-600 focus-visible:ring-offset-2 focus-visible:ring-offset-sand-50 disabled:cursor-not-allowed disabled:bg-sand-300 disabled:text-ink-700 disabled:shadow-none` |
| `Button` secondary | `… bg-white text-ink-900 ring-1 ring-inset ring-sand-400 hover:bg-sand-100` (same focus ring) |
| `Card` | `rounded-2xl border border-sand-200 bg-white shadow-card` |
| `Input`/`Textarea` | `rounded-xl border border-sand-400 bg-white px-4 py-3 text-ink-900 placeholder:text-ink-500 focus:border-lagoon-600 focus:outline-none focus:ring-2 focus:ring-lagoon-600/30` |
| `Chip` | `inline-flex items-center gap-2 rounded-full border border-sand-200 bg-white px-3.5 py-2 text-sm text-ink-700 hover:border-lagoon-600 hover:bg-lagoon-50 hover:text-lagoon-700` |
| `Alert` | `flex gap-3 rounded-xl border-l-4 p-4 text-sm` + per-tone `bg-{tone}-50 border-{tone}-700 text-ink-900`, icon in `text-{tone}-700`, `role="alert"` for errors |

The disabled primary uses `sand-300` bg with `ink-700` text (5.57:1) instead of
`opacity-40`. Today's faded white-on-white disabled button fails contrast.

---

## 3. Icons and imagery

- **Icon system: `lucide-react`** (ISC license; add to `apps/web` deps). Default
  `size={18} strokeWidth={1.75}`, `aria-hidden="true"` whenever a text label sits next
  to the icon. Icon-only buttons need an `aria-label`.
- **No photos.** We have no image rights, and a generic beach photo for a Lisbon trip would
  misrepresent the plan. Instead:
  1. The `bg-sunrise` gradient behind the landing hero and the trip header band.
  2. An original **contour-line SVG pattern** (concentric, wobbly topographic lines)
     authored by us as an inline component, `components/ContourPattern.tsx`. Stroke
     `#0E6B66` at 7% opacity, positioned absolute, `aria-hidden`, `pointer-events-none`,
     masked to fade out toward the content (`[mask-image:radial-gradient(...)]`). Hand-draw
     6–8 paths in an SVG, or generate them once. Don't pull a pattern from a site with
     unclear licensing.
  3. Icons for kinds: flight `Plane`, hotel `BedDouble`, tour `Ticket`, non-bookable
     activity `MapPin`, day `CalendarDays`.
- **No fabricated social proof anywhere**: no testimonials, "trusted by" logos, star
  rows, user counts or placeholder ratings. Ratings appear only where
  `ItineraryOptions` already renders real Google data, and their honesty copy stays
  verbatim (§4.3).
- **Brand mark:** lucide `Compass` in white, inside a 32px `rounded-xl bg-lagoon-600`
  square, followed by "Trip Planner AI" in Fraunces 600 `text-lg`. It sits in a slim top
  bar on every page (`h-16`, transparent over `sand-50`) and links to `/`.

---

## 4. Page-by-page treatment

### 4.1 Global shell (`layout.tsx`, `globals.css`)
- Replace the hard-coded dark `body` colors in `globals.css` with the classes in §2.2.
  Delete the `#0b0f14` / `#e7edf3` rule.
- Add a `<header>` with the brand mark (§3). On trip pages, add a right-aligned secondary
  link: `Plus` icon + "Plan a new trip" → `/`.
- `::selection { background: #E2F0EE; color: #0A5652; }`.
- Skip link "Skip to content" (`sr-only focus:not-sr-only`) as the first focusable element.

### 4.2 Landing / prompt page (`app/page.tsx`)

Layout, top to bottom, inside a `relative overflow-hidden bg-sunrise` section with the
contour pattern behind it:

1. **Eyebrow pill**: `Chip` styling but not interactive, `bg-white/70`, `Sparkles` icon
   in `sunset-600`, text "Describe it. Compare options. Book it your way."
2. **H1 (display)**: "Tell us the feeling." followed by a line break and
   "<em>We'll find the trip.</em>". The `<em>` is Fraunces italic in `text-sunset-600`.
   (Replaces the "Trip Planner AI" H1, since the name is already in the header.)
3. **Subhead (body-lg, ink-700, max-w-xl, centered)**: "Not sure where to go? Say so.
   We'll draft a few options with estimated costs side by side. Then you book each piece
   yourself, straight from the plan."
4. **Prompt box**: a `Card` with `rounded-3xl shadow-lift p-2`, `max-w-2xl w-full`.
   - Borderless textarea inside (`border-0 bg-transparent text-lg p-4 focus:ring-0`, 4
     rows). The card itself shows focus via `focus-within:ring-2 focus-within:ring-lagoon-600/40`.
     Placeholder text is unchanged. Keep a visible `<label class="sr-only">` "Describe your
     trip".
   - Footer row inside the card, `flex items-center justify-between border-t border-sand-100 px-4 py-3`:
     on the left, a caption in ink-500 with a `ShieldCheck` icon: "We never book or charge
     anything." On the right, a primary `Button` reading "Plan my trip" with `ArrowRight`.
   - Submitting: the button shows `Loader2` (spin, motion-safe) and "Drafting your
     options…", and the textarea becomes `readOnly` with `aria-busy`. Copy changed from
     "Planning..." so the user knows what's happening (commitment 3).
   - Error: an `Alert` tone danger directly under the card with an `AlertCircle` icon.
     The message text stays as it is today.
5. **Example prompt chips** (new) under the box: a heading "Or start from one of these"
   (caption, ink-500), then a `flex flex-wrap justify-center gap-2` row of `Chip`s:
   - `Sun` "Surprise me, somewhere warm"
   - `UtensilsCrossed` "A long food weekend in Lisbon, around $1,500"
   - `Heart` "Relaxed week with my partner in March, $2,500"
   - `Wallet` "Mexico City on a tight budget"
   - `Mountain` "Somewhere quiet with hiking, 5 days"

   Behavior: clicking a chip **fills the textarea and focuses it. It does not submit.**
   The user can still edit, which matters because submitting spends model calls. The
   chips are `<button type="button">`. "Surprise me" is first on purpose: it's the
   "I don't know what I want" path from commitment 1.
6. **How it works** (below the hero on `sand-50`, `mt-20`): three columns (stacked on
   mobile), each with a 40px `rounded-full bg-lagoon-50` circle holding a `lagoon-700` icon,
   an h3, and one line of small ink-700:
   - `MessageSquareText` **Describe it**: "Any detail you have, or none at all."
   - `Columns3` **Compare real options**: "Value, balanced and elevated takes, each with an estimated cost."
   - `ExternalLink` **Book it yourself**: "Every flight, hotel and tour links to a ready-made search on the provider's site."

   This section is factual only. No logos, no stats.

### 4.3 Trip dashboard (`app/trip/[id]/page.tsx`)

**Header band:** full-bleed `bg-sunrise` strip behind the top of the page (`pt-8 pb-10`,
contour pattern at 5% opacity), containing:
- h1 trip title (Fraunces 36) and `StatusPill` (§4.6) on one row, wrapping on mobile.
- Meta row (caption, ink-700, `CalendarDays` icon): the date range from `trip.startDate` and
  `trip.endDate` when present (format "Mar 10 – Mar 17, 2027"), and the day count when
  the itinerary exists. If neither is known, omit the row. Don't invent a placeholder.

**Budget card** (`BudgetBar.tsx`, directly under the header, overlapping the band by
`-mt-6` for depth). It's a `Card` with `p-5`. **Everything in it is an estimate, and the
visuals must say so.** We never see a real price, so nothing here may look like a
statement or receipt.
- Left: eyebrow "Estimated cost", then the price-style figure with a leading tilde,
  "~$1,240", followed by "of your $2,500 budget" in body ink-500, all in tabular-nums. The
  figure is the chosen option's estimate. Before a plan is chosen, show only "Budget
  $2,500" with no bar (the option cards carry the per-option estimates).
- Right: "~$1,260 to spare" in small ink-700, or the over-estimate state below.
- Bar: `h-2.5 rounded-full bg-sand-100` track with **one striped fill**,
  `bg-estimate-stripes`. It's never solid: stripes are the visual language for
  "estimate, not final". Clamp the width at 100%. There are no booked/pending segments
  any more, because nothing is ever confirmed in-app.
- Footnote, always visible (caption ink-500, `Info` icon): "Estimate from your plan, not
  live prices. Final prices are set on each provider's site when you book." This
  replaces the "Includes … pending confirmation" line.
- Estimate over budget: the card gets `border-l-4 border-l-warning-700`, the stripes stay
  but the fill turns warning-tinted (`bg-warning-700/40`), and an `AlertTriangle` sits
  beside "Estimated ~$X over budget. Consider the value option or revise the plan." in
  `text-warning-700 font-medium`. **Use warning, not danger**: it's a forecast, not a
  charge that already happened.

**Clarification prompt** (the `pendingClarification` form). It's a question, not a warning,
so it **moves off amber**:
- `Card` with `bg-sunset-50 border-sunset-600/30 border-l-4 border-l-sunset-600 p-5`.
- Top row: `MessageCircleQuestion` icon in sunset-600, eyebrow "One quick question" in
  sunset-600, then the notification message in body ink-900 `font-medium`.
- Input row: `Input` plus a primary `Button` "Send" with a `Send` icon. On mobile, the
  input goes full width and the button stacks below.
- Sending: `Loader2` + "Sending…". Nothing else changes, including the status gating logic.
- Give it `id` + `aria-labelledby`, and move focus to the input when it first appears.

**Planning state (`PLANNING`):**
- An h2 "Drafting a few versions of this trip" with a `Loader2` (spin) before it, and the
  sentence "This takes a minute or so." below it in ink-700. Drop the old "nothing is being
  booked yet", because we never book.
- Three skeleton cards matching the real option card's structure: a 40px tier header
  strip in `sand-100`, a title bar, a price bar and 3 text lines, all `bg-sand-100
  motion-safe:animate-pulse rounded`. A skeleton that mirrors the real layout makes
  the swap feel like progress.
- Keep `aria-hidden` on the skeletons, and add `role="status"` on the text line.

**Options comparison** (`ItineraryOptions.tsx`), the most important visual change. The
three options should look distinct at a glance through color, icon and name, with
redundant cues so it doesn't depend on color vision:

| Tier | Icon | Eyebrow | Header strip | Accent |
|---|---|---|---|---|
| value | `PiggyBank` | VALUE | `bg-value-50 text-value-600` | 4px top border `border-t-value-600` |
| balanced | `Scale` | BALANCED | `bg-balanced-50 text-balanced-600` | `border-t-balanced-600` |
| elevated | `Gem` | ELEVATED | `bg-elevated-50 text-elevated-600` | `border-t-elevated-600` |

Card anatomy (a `Card`, `overflow-hidden border-t-4 flex flex-col`, hover lift):
1. **Tier header strip** (`px-5 py-2.5 flex items-center gap-2`): icon + eyebrow. On the
   cheapest card, add a right-aligned "Lowest estimate" chip (`rounded-full bg-white/70
   text-xs font-medium`).
2. **Body** (`p-5 flex-1`):
   - h3 option label (Fraunces).
   - Price block: the price-style total in tabular-nums with "est. total" caption
     ink-500. Below that is the delta line: "+$330 vs cheapest" in small ink-700, or
     "Lowest estimate" if it's the cheapest. The delta is the comparison signal, so it's
     always on its own line and never truncated.
   - Facts row: a `flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-700` list of icon+text
     pairs: `CalendarDays` "5 days", `MapPin` "14 activities", `Ticket` "4 to book yourself",
     `Gauge` "Pace: Relaxed".
     **The pace badge must read "Pace: Balanced", not just "Balanced"**, because a
     value-tier card with a "Balanced" badge would collide with the balanced tier name.
   - Summary: small ink-700, `line-clamp-4` with a "Read more" toggle when it overflows.
   - Named places, in a `border-t border-sand-200 pt-4 mt-4 space-y-2.5` list: a
     `BedDouble`/`Ticket` icon, the name in small ink-900 `font-medium`, the kind as a
     caption ink-500, and on the right either:
     - Real rating: `inline-flex items-center gap-1 rounded-full bg-sand-100 px-2.5 py-1 text-xs font-medium text-ink-900`
       with a `Star` icon (`fill-current text-sunset-600`, aria-hidden), "4.6", and "·
       1,284 reviews" in ink-500. Keep the existing `aria-label` string exactly.
     - **No rating: the words "No rating available" in `text-sm text-ink-500`.** Don't add a
       grayed star or an empty-pill shape. It must not look like a low rating.
   - Review excerpt (when present): `border-l-2 border-sand-300 pl-3 text-sm italic
     text-ink-700`, with the attribution as a not-italic caption ink-500. The text stays
     verbatim.
3. **Footer** (`p-5 pt-0`): a full-width primary `Button` "Choose this plan" with a
   `Check` icon.

Section header above the grid: an h2 such as "3 ways to do this trip" (drop "— pick
one"; the buttons make that obvious), then "We don't book anything. Once you choose, you'll
get a link to book each piece yourself." as body ink-700 with a `ShieldCheck` icon. The footnotes under the grid ("Estimates for
comparison…" and the `ReviewNote`) become `text-sm text-ink-500` inside a `sand-100
rounded-xl p-4` box with an `Info` icon. The `ReviewNote` copy is unchanged. The estimates
line becomes "Estimated costs, for comparison. Real prices are whatever the provider
charges when you book."

Choosing state (after the first click):
- The chosen card gets `ring-2 ring-lagoon-600 ring-offset-2 ring-offset-sand-50`, and its
  button becomes `Loader2` + "Saving your plan…".
- The other cards go to `opacity-60 saturate-50` with no hover lift, and their buttons are
  disabled, so the user can see their choice registered and doesn't double-submit.
- The `chooseError` alert sits above the grid as an `Alert`. Use tone `info` for anything
  that means "still working" and tone `danger` for real errors. Any old "bookings can
  take a few minutes" copy goes away with the booking pipeline. frontend-dev: the
  component currently receives one `error` string, so add an `errorTone` prop if both
  tones remain.

Grid: `grid gap-5 md:grid-cols-2 lg:grid-cols-3 items-stretch`, so cards are equal height
and the buttons align along the bottom.

> **Backend dependency (blocking for tier colors):** the variant key (`value` /
> `balanced` / `elevated`) is **not persisted**. `persistOptions()` writes the surviving
> drafts with `optionIndex` = position *after* failed variants are dropped, so if the
> value variant fails, `optionIndex 0` is the balanced option. Mapping index to tier would
> mislabel cards. **backend-dev** needs to carry `variant` through
> `ItineraryOptionDraft`/`draftJson` (or add a column) and return it from
> `listItineraryOptions`. Until that lands, render every card with a **neutral header**
> (`bg-sand-100 text-ink-700`, `Route` icon, no eyebrow, `border-t-sand-300`). Don't
> guess a tier from index or price.

**Single option** (`options.length === 1`): same card, centered at `max-w-md`, heading
"Your itinerary".

**Itinerary (after a plan is chosen):** a vertical timeline.
- The left rail is `border-l-2 border-sand-300 ml-5`. Each day has a 40px circle on the
  rail (`bg-white ring-2 ring-sand-300 font-display text-lg text-ink-900`) showing the
  day number.
- The day `Card` sits to the right: h3 "Day 1" plus the date as a caption in ink-500
  ("Tue, Mar 10"), then the summary in small ink-700.
- Activities: `divide-y divide-sand-100`. Each row has the kind icon
  (`Plane`/`BedDouble`/`Ticket` for flight/hotel/tour-or-event, `MapPin` for activities
  with nothing to book) in a 32px `rounded-lg bg-sand-100` tile, then the title in
  `font-medium` with the description below in small ink-500. If `startTime` exists, show
  it as a tabular-nums caption before the title. **There are no per-row status pills any
  more.**
- Bookable rows get the **"Book it yourself" link-out on the right** (stacked under the
  text on mobile). See §4.7 for the exact treatment. Bookable rows also get a faint
  `bg-lagoon-50/40` row tint, so "things you need to act on" are scannable down the
  timeline.
- Day header extra: when a day has bookable items, add a right-aligned caption chip
  "2 to book" (`rounded-full bg-sand-100 text-xs text-ink-700`, `Ticket` icon).
- Status banners: "Setting up …" / "Plan locked in — booking…" go away. If saving the
  choice is ever slow enough to need one, use an `Alert` tone `info` with `Loader2` and
  "Saving your plan…".

**Already chosen (409) / planning failed / no options / options fetch error:** see §4.5.

**Persistent revise surface (reserved slot, commitment 1).** It doesn't exist in code yet,
but it's owned by the revision-flow branch, which should build it to this visual spec:
- A sticky dock at the bottom of the trip page in **every** status, outside all status
  conditionals: `sticky bottom-0 z-20`, full width, `bg-white/95 backdrop-blur border-t
  border-sand-200 shadow-dock`. Inner `max-w-5xl mx-auto px-6 py-3 flex gap-3`.
- Contents: a `Wand2` icon in lagoon-600, then a one-line auto-growing `Textarea` (max 4
  rows) with the placeholder "Change anything — e.g. 'cheaper hotel', 'swap day 3 for a
  beach day'", a visible label "Revise this trip" (`sr-only` is not enough; use an
  eyebrow above it on md+), and a primary `Button` "Revise" with `ArrowUp`.
- Add `pb-32` on `<main>` so the dock never covers the last notification.
- Until the revise endpoint exists, **don't ship a fake dock** whose button does nothing.
  This slot is specified so the layout accounts for it.

### 4.4 Notifications (bottom of the trip page)
- Section h2 "Updates" with an unread count badge (`bg-lagoon-600 text-white text-xs
  rounded-full px-2`) when `unreadCount > 0`. That value is already returned by the API.
- The list goes in a `Card` with `divide-y divide-sand-100`. Each row is `flex gap-3 p-4`:
  a 32px `rounded-full` icon tile, the message in small ink-900, and a relative time caption
  in ink-500 from `createdAt` ("4 min ago", via `Intl.RelativeTimeFormat`). The full
  timestamp goes in `<time dateTime title>`. The API's order stays as it is (newest first).

| Kind | Icon | Tile |
|---|---|---|
| ITINERARY_READY | `Columns3` | `bg-lagoon-50 text-lagoon-700` |
| CLARIFICATION_NEEDED | `MessageCircleQuestion` | `bg-sunset-50 text-sunset-600` |
| BUDGET_ALERT (if kept for "estimate over budget") | `AlertTriangle` | `bg-warning-50 text-warning-700` |
| GENERAL, and any unknown/legacy kind (old BOOKING_CONFIRMED/BOOKING_FAILED rows on existing trips) | `Info` | `bg-sand-100 text-ink-700` |

The booking-confirmed and booking-failed tiles are retired with the booking pipeline.

- Wrap the list in `aria-live="polite"` so new updates from the 4s poll are announced.
- Empty: "No updates yet. We'll post here as your plan comes together." in small
  ink-500, with a `Bell` icon.

### 4.5 Empty, loading and error states

All of them are composed from the same primitives: a centered or inline `Card`, an icon,
one heading line, one explanation line, and one action. They are never a bare red line.

| State (where) | Treatment | Copy |
|---|---|---|
| Trip loading (`!data`) | Header-band skeleton (title bar + pill) + budget card skeleton, pulse | `role="status"` sr text "Loading your trip…" |
| Trip load error (`error`) | Centered `Card` `max-w-md`, `MapPinOff` icon in danger-700, h2 "We couldn't load this trip", the error text in small ink-500, and a primary "Try again" (reload) plus a secondary "Plan a new trip" | Existing error string as detail |
| Options loading | Same 3 skeleton cards as PLANNING | "Loading your options…" (`role="status"`) |
| Options fetch error | `Alert` danger with `RefreshCw` "Try again" secondary button inside | Existing two-sentence copy unchanged |
| No options | `Alert` warning, `Compass` icon | Existing copy |
| Planning failed | `Card` with `border-l-4 border-l-warning-700`, `AlertTriangle`, h3 "We couldn't draft options for this trip", body = existing copy, secondary button "Plan a new trip" → `/` | Existing copy |
| Already chosen (409) | `Alert` info, `CheckCircle2` | "A plan has already been chosen for this trip." (drop "booking is underway") |
| Bookable item with no link | Inline in the row, see §4.7 | "No search link: missing {travel dates}" |
| Landing submit error | `Alert` danger under prompt box | Existing |

Errors use `role="alert"`. Loading uses `role="status"`. Retry buttons say what they do.

### 4.6 Status pills (`StatusPill.tsx`)

Shape: `inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium`
+ icon (14px) + label. In-progress states get the spinning `Loader2` (motion-safe), so
there's always a word *and* an icon. The pill is now **trip-level only**. Per-booking pills
(SEARCHING / OPTIONS_FOUND / AWAITING_CONFIRMATION / BOOKED / FAILED / CANCELLED) are
retired, because we no longer book.

| Trip status | Label | Classes | Icon |
|---|---|---|---|
| DRAFT | Draft | `bg-sand-100 text-ink-700` | `PencilLine` |
| PLANNING | Planning… | `bg-lagoon-50 text-lagoon-700` | `Loader2` (spin) |
| CHOOSING | Choose a plan | `bg-lagoon-600 text-white` | `Columns3` (the user's turn, so it's the strongest pill) |
| Post-choice status (whatever backend-dev names it, e.g. `CONFIRMED`/`READY`) | **Plan ready** | `bg-success-50 text-success-700` | `CheckCircle2` |
| NEEDS_ATTENTION | Needs your input | `bg-warning-50 text-warning-700` | `AlertTriangle` |
| COMPLETED | Completed | `bg-sand-100 text-ink-700` | `Flag` |
| legacy `BOOKING` on old trips, or unknown | "Plan ready" if an itinerary exists, otherwise the raw status | `bg-sand-100 text-ink-700` | `Circle` |

Don't label the post-choice state "Confirmed" or "Booked". Nothing has been booked
until the user does it on the provider's site.

### 4.7 "Book it yourself" link-out (new, replaces all booking states)

One component, `components/BookLink.tsx`, used on every bookable item in the chosen
itinerary. Data it needs per item: a provider display name (e.g. "Google Flights") and
the deterministic URL from backend-dev. Optionally it takes a short human summary of what
the search will look for (e.g. "LIS → MEX · Mar 10").

- **Element:** a real `<a href target="_blank" rel="noopener noreferrer">`, never a button
  with JS navigation, so middle-click, copy-link and "open in new tab" all work.
- **Look:** secondary-button styling: `inline-flex items-center gap-1.5 rounded-xl bg-white
  px-3.5 py-2 text-sm font-semibold text-lagoon-700 ring-1 ring-inset ring-sand-400
  hover:bg-lagoon-50 hover:ring-lagoon-600` with the standard focus ring. It's deliberately
  *not* the solid primary button: a day can have several of these, and a column of solid
  teal blocks would shout.
- **Text:** "Search on {Provider}", then the `ExternalLink` icon (16px, `aria-hidden`), then
  `<span class="sr-only">(opens in a new tab)</span>`. Examples: "Search on Google
  Flights", "Search on Booking.com", "Search on Viator". Use the lucide icon rather than a
  "↗" glyph, which screen readers read out inconsistently. Say "Search", not "Book now",
  because the link opens a prefilled search. Price and availability are the provider's,
  and the copy shouldn't promise more.
- **Eyebrow above the first link in a row group** (or as a row label on mobile): "Book it
  yourself", caption, ink-500.
- **What-it-searches line** (if the summary is provided): caption ink-500 under the link,
  tabular-nums, e.g. "LIS → MEX · Tue, Mar 10 · 2 adults". The user can check the prefill
  before leaving the app, which keeps the honesty principle visible.
- **No link available** (e.g. missing dates or origin, so no deterministic link can be
  built): don't render a disabled button or a link that guesses. Show
  `text-sm text-ink-500` with an `Unlink` icon: "No search link: missing
  travel dates". Name the missing detail when backend provides it. If the revise dock
  exists, append "Add them below."
- **Never** render a URL that came from model output, even as a fallback. If backend
  marks a link as missing, the UI shows the no-link state, full stop.
- **Option cards (CHOOSING):** no links on the cards. Links appear only after a plan is
  chosen, so the comparison stays a comparison. The "4 to book yourself" fact sets the
  expectation.

### 4.8 Per-day "things to book" checklist (optional, v2)

A self-tracked checklist so the user can see what they've already booked elsewhere.
**We can't verify any of it, and the visuals must not pretend we can.**

- **Placement:** inside each day card, under the activities, only when the day has bookable
  items. It's a `rounded-xl bg-sand-50 p-4` box with a heading "Things to book" (eyebrow
  ink-500) and a counter on the right, "1 of 2 done" (caption, tabular-nums).
- **Rows:** a native checkbox (`h-5 w-5 rounded border-sand-400 text-lagoon-600
  focus-visible:ring-lagoon-600`, styled via `accent-color: #0E6B66` or `@tailwindcss/forms`),
  a label with the item name and kind icon, and that item's `BookLink` on the right. The whole label is
  clickable, with ≥44px row height.
- **Checked state:** the row text goes to ink-500, and a small caption appears: `Check`
  icon + "You marked this booked". **No strikethrough and no success-green "Booked"
  pill.** The wording makes clear it's the user's own note. The link stays available in
  case they need it again.
- **Trip-level summary (optional):** in the header meta row, "3 of 7 things booked (your
  checklist)".
- **Persistence:** v2 decision for backend-dev. Either a per-activity `userMarkedBooked`
  boolean via API, or `localStorage` keyed by trip + activity id as a stopgap. If
  localStorage, add a caption "Saved on this device" so nobody expects it on their phone.
- **Motion:** checkbox tick only, 150ms, motion-safe. No celebration.

---

## 5. Accessibility checklist (applies to everything above)

- Every text/background pair used comes from the measured table in §2.1. Input borders
  use `sand-400` (≥3:1).
- Visible focus everywhere: `focus-visible:ring-2 ring-lagoon-600 ring-offset-2`. Never
  `outline-none` without a replacement (today's inputs remove the outline and only shift
  a border shade).
- Color is never the only signal. Tiers have icon + eyebrow, statuses have icon + word, and
  estimates are always striped.
- Touch targets are ≥ 44px tall on mobile (chips `py-2` + 14px text ≈ 38px, so use `py-2.5`
  on `<sm`).
- `aria-live="polite"` on notifications and on the status banner, `role="alert"` on
  errors, `role="status"` on loading, and `aria-busy` on submitting forms.
- Heading order: one h1 per page, then h2 sections, then h3 cards.
- Keep the existing `aria-label` on `RatingBadge`, and keep the "No rating available"
  words visible (not just in an aria-label).

---

## 6. Prioritized implementation checklist (frontend-dev)

**P0: foundation (lands first, one PR):**
1. Add `lucide-react` to `apps/web`. Create `app/fonts.ts` (Fraunces + Inter) and wire it
   into `layout.tsx`.
2. Extend `tailwind.config.js` with the colors, fontFamily, borderRadius `3xl`, boxShadow
   and backgroundImage from §2. (`line-clamp-*`, used on option summaries, is
   built into Tailwind 3.3+, so no plugin is needed.)
3. Rewrite `globals.css`: remove the dark body colors, add the `.font-display` variation
   settings, `::selection`, and the reduced-motion block.
4. Build `components/ui/` primitives: Button (primary/secondary), Card, Input/Textarea,
   Chip, Alert.
5. Restyle `StatusPill` per §4.6. It's used everywhere, so it changes the whole app's feel
   cheaply.

**P1: the pages the product owner sees first:**
6. Landing (§4.2): header/brand mark, sunrise hero + contour pattern, new H1/subhead,
   prompt card, submitting/error states, example chips (fill-and-focus, no submit), and
   the How it works strip.
7. Options comparison (§4.3): tier header strips, price/delta block, facts row with
   "Pace: …", named places + RatingBadge restyle, honesty notes at `text-sm`, choosing
   and locked states, info vs danger alert tone. **Ship with the neutral header** until
   backend-dev persists `variant`.
8. Trip header band + BudgetBar redesign as **estimate-only** (striped fill, "~" figures,
   always-visible "not live prices" footnote, warning-tone over-estimate state).
9. `BookLink` component (§4.7) and the itinerary rows that use it: provider name,
   `ExternalLink` icon, new tab, sr-only "(opens in a new tab)", what-it-searches line,
   and the honest no-link state. This is the product's main action now, so it's P1.
10. Clarification card (sunset, not amber) with focus management.

**P2: the rest of the dashboard:**
11. Itinerary timeline with kind icons, bookable-row tint and per-day "N to book" chip.
    Remove per-row booking pills and the booking banners.
12. Notifications as an icon list with relative times, unread badge, `aria-live`, and
    legacy kinds falling back to the GENERAL tile.
13. All empty/loading/error states from §4.5 (skeletons that mirror real layouts).
14. Remove leftover booking copy app-wide: "Starting bookings…", "booking is underway",
    "nothing is being booked yet", "Real prices come from the provider when we book",
    plus the booking statuses in `StatusPill`.
15. Motion pass: hover lift, enter fade/rise, budget width transition. All
    `motion-safe:`. Verify with the OS "reduce motion" setting on.

**Optional / v2:**
16. Per-day "Things to book" checklist (§4.8). It needs a persistence decision from
    backend-dev (API field vs localStorage + "Saved on this device").

**Dependencies / other owners:**
- **backend-dev:**
  - Persist and return the option `variant` key (§4.3 callout). This unblocks the tier
    colors in item 7.
  - For each bookable item, expose: provider display name, deterministic URL (or an
    explicit "no link" plus the missing field), and optionally a short search summary.
  - Expose the chosen option's estimate to `BudgetBar`.
  - Tell frontend-dev the name of the post-choice trip status.
- **revision-flow branch:** build the persistent revise dock to the §4.3 spec in every
  trip status. frontend-dev should add the `pb-32` page padding now.
- **qa-tester:** check every state in §4.5 and §4.6 renders, not just the happy path
  (including NOT_CONFIGURED ratings, estimate over budget, 409, bookable items with no
  link, and the options fetch error), at 375px and 1280px, with reduce-motion on, plus a
  keyboard-only pass through landing → choose → opening a "Search on …" link. Also verify
  that every rendered link URL comes from the deterministic builder, never from model
  text.

## 7. Out of scope for this pass
- Dark mode. Tokens are named by role so a dark set can be added later.
- Any payment, checkout or in-app booking UI. The product no longer books or charges.
- Destination photography, maps or illustrations. Revisit only with a licensed source
  (e.g. a provider's own property images under their terms) and only where the image is
  of the actual place being booked.
- Any change to copy that's flagged above as "unchanged", or to the status-gating
  logic in the trip page.
