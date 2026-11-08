"use client";

import { useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  BedDouble,
  Bot,
  CalendarDays,
  Check,
  Gauge,
  Gem,
  Info,
  Loader2,
  MapPin,
  PiggyBank,
  Route,
  Scale,
  ShieldCheck,
  Star,
  Ticket,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import type { BookingMode } from "@trip-planner/db";
import { DietaryBadges, DietaryCaveat, type DietConflict, type Dining, type LocalFood } from "./Food";
import type { RestaurantLookupStatus } from "@trip-planner/core";
import { ResearchLinks } from "./ResearchLinks";
import { Alert, buttonClasses, fmtMoney } from "./ui";

// The options-comparison view: 2-3 candidate itineraries side by side with
// enough to actually choose between them (cost delta, pace, shape, and real
// ratings on the named hotels/tours). Visuals: docs/visual-design.md §4.3.
//
// Honesty rule this component enforces: a rating is rendered only when real
// rating data came back from the provider. Anything else renders the words
// "No rating available" -- never a zero, never a placeholder star row.

type ReviewExcerpt = {
  text: string;
  rating?: number;
  authorName?: string;
  relativeTime?: string;
};

type AttachedReview = {
  name: string;
  rating?: number;
  userRatingsTotal?: number;
  excerpts?: ReviewExcerpt[];
  googleMapsUri?: string;
};

type Bookable = {
  kind: "FLIGHT" | "HOTEL" | "TOUR";
  searchHint: string;
  candidateName?: string;
  review?: AttachedReview;
  /** Google / Reddit "see what people say" links, added by the options API. */
  research?: Array<{ provider: string; url: string }>;
};

type OptionDay = {
  dayIndex: number;
  date?: string;
  summary?: string;
  activities: Array<{ title: string; bookable?: Bookable; dining?: Dining; conflicts?: DietConflict[] }>;
};

type ReviewLookup =
  | { status: "OK"; named: number; lookedUp: number; matched: number; failed: number }
  | { status: "NOT_CONFIGURED"; message: string }
  | { status: "UNAVAILABLE"; message: string }
  | { status: "NO_CANDIDATES" };

export type ItineraryOption = {
  id: string;
  optionIndex: number;
  status: string;
  label: string;
  summary: string;
  pace: string;
  estimatedTotalCents: number;
  currency: string;
  draft: {
    days: OptionDay[];
    reviewLookup: ReviewLookup;
    variant?: string;
    localFoods?: LocalFood[];
    restaurantLookup?: RestaurantLookupStatus;
  };
};

type Tier = { eyebrow: string; Icon: LucideIcon; strip: string; top: string };

// Tier identity is color + icon + name together, so it never depends on color
// vision. Driven by the persisted variant key -- never guessed from position
// or price. Options without one (generated before it was stored) get the
// neutral header.
const TIERS: Record<string, Tier> = {
  value: { eyebrow: "Value", Icon: PiggyBank, strip: "bg-value-50 text-value-600", top: "border-t-value-600" },
  balanced: { eyebrow: "Balanced", Icon: Scale, strip: "bg-balanced-50 text-balanced-600", top: "border-t-balanced-600" },
  elevated: { eyebrow: "Elevated", Icon: Gem, strip: "bg-elevated-50 text-elevated-600", top: "border-t-elevated-600" },
};
const NEUTRAL_TIER: Tier = { eyebrow: "", Icon: Route, strip: "bg-sand-100 text-ink-700", top: "border-t-sand-300" };

const PACE_LABELS: Record<string, string> = {
  relaxed: "Relaxed",
  balanced: "Balanced",
  packed: "Packed",
};

/** Meals in an option, and which stops/dishes may conflict with the traveller's needs. */
function foodSummary(option: ItineraryOption) {
  const activities = option.draft.days.flatMap((d) => d.activities);
  const meals = activities.flatMap((a) => (a.dining ? [a.dining] : []));
  const restaurants = [...new Set(meals.flatMap((m) => (m.restaurantName ? [m.restaurantName] : [])))];
  // Google Places checks, per distinct restaurant (case-insensitive). Only
  // names that were actually checked count: unchecked ones (over the cap, a
  // failed lookup) are neither "found" nor "not found".
  const checked = new Map(
    meals.flatMap((m) => (m.restaurantName && m.check ? [[m.restaurantName.trim().toLowerCase(), { name: m.restaurantName, check: m.check }] as const] : [])),
  );
  const found = [...checked.values()].filter(({ check }) => check.status !== "NOT_FOUND").length;
  const closed = [...checked.values()]
    .filter(({ check }) => check.status === "CLOSED_PERMANENTLY" || check.status === "CLOSED_TEMPORARILY")
    .map(({ name }) => name);
  const foods = option.draft.localFoods ?? [];
  // Named, so the traveller can judge before choosing -- not just a count.
  const flagged = [
    ...activities.flatMap((a) => (a.conflicts?.length ? [{ name: a.title, conflicts: a.conflicts }] : [])),
    ...foods.flatMap((f) => (f.conflicts?.length ? [{ name: f.name, conflicts: f.conflicts }] : [])),
  ];
  return { meals: meals.length, restaurants, foods, flagged, checkedCount: checked.size, found, closed };
}

/** Named HOTEL/TOUR candidates, which are the only items a rating applies to. */
function namedPlaces(days: OptionDay[]): Bookable[] {
  const out: Bookable[] = [];
  for (const day of days) {
    for (const activity of day.activities) {
      const b = activity.bookable;
      if (b?.candidateName && (b.kind === "HOTEL" || b.kind === "TOUR")) out.push(b);
    }
  }
  return out;
}

const countBookables = (days: OptionDay[]) =>
  days.reduce((sum, day) => sum + day.activities.filter((a) => a.bookable).length, 0);
const countActivities = (days: OptionDay[]) =>
  days.reduce((sum, day) => sum + day.activities.length, 0);

function RatingBadge({ review }: { review?: AttachedReview }) {
  // No real rating -> say that, in words, and don't make it look like a low rating.
  if (!review || review.rating === undefined) {
    return <span className="shrink-0 text-sm text-ink-500">No rating available</span>;
  }
  const label =
    review.userRatingsTotal === undefined
      ? `Rated ${review.rating.toFixed(1)} out of 5 on Google`
      : `Rated ${review.rating.toFixed(1)} out of 5 on Google from ${review.userRatingsTotal} reviews`;

  return (
    <span
      aria-label={label}
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sand-100 px-2.5 py-1 text-xs font-medium tabular-nums text-ink-900"
    >
      <Star size={12} aria-hidden="true" className="fill-current text-sunset-600" />
      <span>{review.rating.toFixed(1)}</span>
      {review.userRatingsTotal !== undefined && (
        <span className="text-ink-500">
          · {new Intl.NumberFormat("en-US").format(review.userRatingsTotal)} reviews
        </span>
      )}
    </span>
  );
}

/** Why some (or all) restaurants show no Google check. Silent when there's nothing to explain. */
function RestaurantNote({ lookup }: { lookup: RestaurantLookupStatus }) {
  if (lookup.status === "NOT_CONFIGURED") {
    return <p>Restaurants weren&apos;t checked on Google: Google Places isn&apos;t configured.</p>;
  }
  if (lookup.status === "UNAVAILABLE") {
    return <p>Restaurants couldn&apos;t be checked on Google just now. That&apos;s on us, not the restaurants.</p>;
  }
  if (lookup.status === "OK" && lookup.unchecked > 0) {
    return (
      <p>
        Checked {lookup.checked} of {lookup.named} named restaurants on Google; the rest show no check (lookup limit or a
        failed lookup).
      </p>
    );
  }
  return null;
}

function ReviewNote({ lookup }: { lookup: ReviewLookup }) {
  if (lookup.status === "NOT_CONFIGURED") {
    return (
      <p>
        Google Places isn&apos;t configured, so no ratings could be looked up. Set
        GOOGLE_PLACES_API_KEY to see real ratings here.
      </p>
    );
  }
  if (lookup.status === "UNAVAILABLE") {
    // Configured but broken. Must not read as "none of these places exist".
    return (
      <p>
        Ratings couldn&apos;t be looked up right now ({lookup.message}) — that&apos;s on us, not a
        reflection of these places.
      </p>
    );
  }
  if (lookup.status === "NO_CANDIDATES") {
    return <p>None of these options named a specific hotel or tour to look up ratings for.</p>;
  }
  return (
    <p>
      Matched real Google ratings for {lookup.matched} of {lookup.named} named{" "}
      {lookup.named === 1 ? "place" : "places"}
      {lookup.named > lookup.lookedUp ? ` (only the first ${lookup.lookedUp} were looked up)` : ""}
      {lookup.failed > 0 ? `; ${lookup.failed} lookup${lookup.failed === 1 ? "" : "s"} failed` : ""}.
    </p>
  );
}

function Summary({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 220;
  return (
    <div className="mt-4">
      <p className={`text-sm text-ink-700 ${long && !open ? "line-clamp-4" : ""}`}>{text}</p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-1 rounded text-sm font-medium text-lagoon-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lagoon-600"
        >
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}

export function ItineraryOptions({
  options,
  onChoose,
  choosingId,
  disabled,
  error,
  errorTone = "danger",
  bookingMode = "SELF",
  modePicker,
  dietary,
}: {
  options: ItineraryOption[];
  onChoose: (optionId: string) => void;
  choosingId: string | null;
  disabled: boolean;
  error: string | null;
  /** "info" for "still working" messages, which aren't failures. */
  errorTone?: "danger" | "info";
  bookingMode?: BookingMode;
  /** The booking-mode fieldset, rendered between the header and the cards. */
  modePicker?: React.ReactNode;
  /** Labels of the traveller's dietary needs ("Halal", "Allergy: peanuts"). */
  dietary?: string[];
}) {
  const aiBooks = bookingMode === "AI";
  const cheapest = Math.min(...options.map((o) => o.estimatedTotalCents));
  const lookup = options[0]?.draft.reviewLookup;
  const single = options.length === 1;
  const summaries = options.map(foodSummary);

  return (
    <section className="mt-12" aria-labelledby="options-heading">
      <h2 id="options-heading" className="font-display text-2xl font-semibold text-ink-900">
        {single ? "Your itinerary" : `${options.length} ways to do this trip`}
      </h2>
      <p className="mt-2 flex items-center gap-2 text-ink-700">
        <ShieldCheck size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-lagoon-600" />
        Nothing is booked until you choose a plan.
      </p>
      <DietaryBadges labels={dietary} className="mt-2" />

      {modePicker}

      {error && (
        <Alert
          tone={errorTone}
          className="mt-6"
          icon={
            errorTone === "info" ? (
              <Loader2 size={18} strokeWidth={1.75} aria-hidden="true" className="motion-safe:animate-spin" />
            ) : undefined
          }
        >
          {error}
        </Alert>
      )}

      <ul
        className={`mt-6 grid items-stretch gap-5 ${
          single ? "mx-auto max-w-md" : options.length === 2 ? "md:grid-cols-2" : "md:grid-cols-2 lg:grid-cols-3"
        }`}
      >
        {options.map((option, i) => {
          const tier = (option.draft.variant && TIERS[option.draft.variant]) || NEUTRAL_TIER;
          const places = namedPlaces(option.draft.days);
          const delta = option.estimatedTotalCents - cheapest;
          const isCheapest = delta === 0 && !single;
          const isChoosing = choosingId === option.id;
          const locked = choosingId !== null && !isChoosing;
          const food = summaries[i]!;
          const hotelExcerpt = places
            .find((p) => p.kind === "HOTEL" && p.review?.excerpts?.length)
            ?.review?.excerpts?.[0];

          return (
            <li
              key={option.id}
              style={{ animationDelay: `${i * 60}ms` }}
              className={`flex flex-col overflow-hidden rounded-2xl border border-t-4 border-sand-200 bg-white shadow-card motion-safe:animate-rise motion-safe:transition motion-safe:duration-200 ${tier.top} ${
                locked ? "opacity-60 saturate-50" : "motion-safe:hover:-translate-y-0.5 hover:shadow-lift"
              } ${isChoosing ? "ring-2 ring-lagoon-600 ring-offset-2 ring-offset-sand-50" : ""}`}
            >
              {/* Tier header strip */}
              <div className={`flex items-center gap-2 px-5 py-2.5 ${tier.strip}`}>
                <tier.Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                {tier.eyebrow && (
                  <span className="text-xs font-semibold uppercase tracking-[0.12em]">{tier.eyebrow}</span>
                )}
                {isCheapest && (
                  <span className="ml-auto rounded-full bg-white/70 px-2.5 py-0.5 text-xs font-medium">
                    Lowest estimate
                  </span>
                )}
              </div>

              <div className="flex-1 p-5">
                <h3 className="font-display text-xl font-semibold leading-tight text-ink-900">{option.label}</h3>

                <div className="mt-4 tabular-nums">
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-semibold text-ink-900">
                      {fmtMoney(option.estimatedTotalCents, option.currency)}
                    </span>
                    <span className="text-xs font-medium text-ink-500">est. total</span>
                  </div>
                  {/* The cheapest card says "Lowest estimate" once, in its tier strip. */}
                  {!single && delta > 0 && (
                    <p className="mt-1 text-sm text-ink-700">+{fmtMoney(delta, option.currency)} vs cheapest</p>
                  )}
                </div>

                <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums text-ink-700">
                  <li className="flex items-center gap-1.5">
                    <CalendarDays size={16} strokeWidth={1.75} aria-hidden="true" />
                    {option.draft.days.length} days
                  </li>
                  <li className="flex items-center gap-1.5">
                    <MapPin size={16} strokeWidth={1.75} aria-hidden="true" />
                    {countActivities(option.draft.days)} activities
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Ticket size={16} strokeWidth={1.75} aria-hidden="true" />
                    {countBookables(option.draft.days)} to book
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Gauge size={16} strokeWidth={1.75} aria-hidden="true" />
                    {/* "Pace: Balanced", never bare "Balanced" -- it would collide with the tier name. */}
                    Pace: {PACE_LABELS[option.pace] ?? option.pace}
                  </li>
                </ul>

                <Summary text={option.summary} />

                {places.length > 0 && (
                  <ul className="mt-4 space-y-2.5 border-t border-sand-200 pt-4">
                    {places.map((place, j) => {
                      const KindIcon = place.kind === "HOTEL" ? BedDouble : Ticket;
                      return (
                        <li key={`${place.kind}-${j}`} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                          <span className="flex min-w-[10rem] flex-1 items-start gap-2">
                            <KindIcon
                              size={16}
                              strokeWidth={1.75}
                              aria-hidden="true"
                              className="mt-0.5 shrink-0 text-ink-500"
                            />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-ink-900">
                                {place.review?.name ?? place.candidateName}
                              </span>
                              <span className="block text-xs text-ink-500">
                                {place.kind === "HOTEL" ? "Hotel" : "Tour"}
                              </span>
                              <ResearchLinks
                                links={place.research}
                                subject={place.review?.name ?? place.candidateName ?? "this place"}
                              />
                            </span>
                          </span>
                          <RatingBadge review={place.review} />
                        </li>
                      );
                    })}
                  </ul>
                )}

                {(food.meals > 0 || food.foods.length > 0 || food.flagged.length > 0) && (
                  <div className="mt-4 space-y-1.5 border-t border-sand-200 pt-4 text-sm text-ink-700">
                    <p className="flex items-start gap-2">
                      <UtensilsCrossed size={16} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-500" />
                      <span>
                        {food.meals} meal{food.meals === 1 ? "" : "s"} planned
                        {food.restaurants.length > 0 &&
                          `, incl. ${food.restaurants.slice(0, 2).join(" and ")}${
                            food.restaurants.length > 2 ? ` +${food.restaurants.length - 2} more` : ""
                          }`}
                      </span>
                    </p>
                    {food.checkedCount > 0 && (
                      <p className="flex items-center gap-1.5 pl-6 text-xs text-ink-700">
                        <BadgeCheck size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-success-700" />
                        {food.found} of {food.checkedCount} checked restaurant{food.checkedCount === 1 ? "" : "s"} found on
                        Google
                      </p>
                    )}
                    {food.closed.length > 0 && (
                      <p className="flex items-start gap-1.5 pl-6 text-xs font-medium text-danger-700">
                        <AlertTriangle size={14} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0" />
                        Listed as closed on Google: {food.closed.join(", ")}
                      </p>
                    )}
                    {food.foods.length > 0 && (
                      <p className="pl-6 text-xs text-ink-500">
                        Local food to try: {food.foods.slice(0, 4).map((f) => f.name).join(", ")}
                        {food.foods.length > 4 ? "…" : ""}
                      </p>
                    )}
                    {food.flagged.length > 0 && (
                      <div className="pl-6 text-xs text-warning-700">
                        <p className="flex items-start gap-1.5 font-medium">
                          <AlertTriangle size={14} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0" />
                          May not suit your diet:
                        </p>
                        <ul className="mt-0.5 list-disc space-y-0.5 pl-9">
                          {food.flagged.slice(0, 3).map((f, k) => (
                            <li key={`${f.name}-${k}`}>
                              {f.name} ({f.conflicts.map((c) => `${c.need}: ${c.words.join(", ")}`).join("; ")})
                            </li>
                          ))}
                          {food.flagged.length > 3 && <li>and {food.flagged.length - 3} more</li>}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {hotelExcerpt && (
                  <blockquote className="mt-4 border-l-2 border-sand-300 pl-3 text-sm italic text-ink-700">
                    {/* Real Google reviews run long; four lines is enough to get the gist on a card. */}
                    <span className="line-clamp-4" title={hotelExcerpt.text}>
                      “{hotelExcerpt.text}”
                    </span>
                    {hotelExcerpt.authorName && (
                      <footer className="mt-1 text-xs not-italic text-ink-500">
                        — {hotelExcerpt.authorName}
                        {hotelExcerpt.relativeTime ? `, ${hotelExcerpt.relativeTime}` : ""}
                      </footer>
                    )}
                  </blockquote>
                )}
              </div>

              <div className="p-5 pt-0">
                <button
                  type="button"
                  onClick={() => onChoose(option.id)}
                  disabled={disabled}
                  className={buttonClasses("primary", "w-full")}
                >
                  {isChoosing ? (
                    <>
                      <Loader2 size={16} strokeWidth={2} aria-hidden="true" className="motion-safe:animate-spin" />
                      {aiBooks ? "Starting bookings…" : "Saving your plan…"}
                    </>
                  ) : aiBooks ? (
                    <>
                      <Bot size={16} strokeWidth={2} aria-hidden="true" />
                      Choose and start booking
                    </>
                  ) : (
                    <>
                      <Check size={16} strokeWidth={2} aria-hidden="true" />
                      Choose this plan
                    </>
                  )}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 flex gap-3 rounded-xl bg-sand-100 p-4 text-sm text-ink-500">
        <Info size={18} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0" />
        <div className="space-y-1">
          <p>
            {aiBooks
              ? "Estimated costs, for comparison. The AI checks real prices against your budget before booking anything."
              : "Estimated costs, for comparison. Real prices are on the booking sites we link you to."}
          </p>
          {lookup && <ReviewNote lookup={lookup} />}
          {options[0]?.draft.restaurantLookup && <RestaurantNote lookup={options[0].draft.restaurantLookup} />}
          {summaries.some((f) => f.meals > 0) && <DietaryCaveat labels={dietary} />}
        </div>
      </div>
    </section>
  );
}
