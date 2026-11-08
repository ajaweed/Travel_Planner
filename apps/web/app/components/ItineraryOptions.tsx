"use client";

// The options-comparison view: 2-3 candidate itineraries side by side with
// enough to actually choose between them (cost delta, pace, shape, and real
// ratings on the named hotels/tours). Implements the ux-designer spec in
// docs/team-log.md.
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
};

type OptionDay = {
  dayIndex: number;
  date?: string;
  summary?: string;
  activities: Array<{ title: string; bookable?: Bookable }>;
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
  draft: { days: OptionDay[]; reviewLookup: ReviewLookup };
};

function fmt(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

const PACE_LABELS: Record<string, string> = {
  relaxed: "Relaxed",
  balanced: "Balanced",
  packed: "Packed",
};

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

function countBookables(days: OptionDay[]): number {
  return days.reduce(
    (sum, day) => sum + day.activities.filter((a) => a.bookable).length,
    0,
  );
}

function countActivities(days: OptionDay[]): number {
  return days.reduce((sum, day) => sum + day.activities.length, 0);
}

function RatingBadge({ review }: { review?: AttachedReview }) {
  // No real rating -> say that, in words. See the honesty rule above.
  if (!review || review.rating === undefined) {
    return <span className="text-xs text-neutral-500">No rating available</span>;
  }
  const label =
    review.userRatingsTotal === undefined
      ? `Rated ${review.rating.toFixed(1)} out of 5 on Google`
      : `Rated ${review.rating.toFixed(1)} out of 5 on Google from ${review.userRatingsTotal} reviews`;

  return (
    <span
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-200"
    >
      <span aria-hidden="true">★</span>
      <span className="font-medium">{review.rating.toFixed(1)}</span>
      {review.userRatingsTotal !== undefined && (
        <span className="text-neutral-400">
          · {new Intl.NumberFormat("en-US").format(review.userRatingsTotal)} reviews
        </span>
      )}
    </span>
  );
}

function ReviewNote({ lookup }: { lookup: ReviewLookup }) {
  if (lookup.status === "NOT_CONFIGURED") {
    return (
      <p className="text-xs text-neutral-500">
        Google Places isn&apos;t configured, so no ratings could be looked up. Set
        GOOGLE_PLACES_API_KEY to see real ratings here.
      </p>
    );
  }
  if (lookup.status === "UNAVAILABLE") {
    // Configured but broken. Must not read as "none of these places exist".
    return (
      <p className="text-xs text-neutral-500">
        Ratings couldn&apos;t be looked up right now ({lookup.message}) — that&apos;s on us,
        not a reflection of these places.
      </p>
    );
  }
  if (lookup.status === "NO_CANDIDATES") {
    return (
      <p className="text-xs text-neutral-500">
        None of these options named a specific hotel or tour to look up ratings for.
      </p>
    );
  }
  return (
    <p className="text-xs text-neutral-500">
      Matched real Google ratings for {lookup.matched} of {lookup.named} named{" "}
      {lookup.named === 1 ? "place" : "places"}
      {lookup.named > lookup.lookedUp
        ? ` (only the first ${lookup.lookedUp} were looked up)`
        : ""}
      {lookup.failed > 0
        ? `; ${lookup.failed} lookup${lookup.failed === 1 ? "" : "s"} failed`
        : ""}
      .
    </p>
  );
}

export function ItineraryOptions({
  options,
  onChoose,
  choosingId,
  disabled,
  error,
}: {
  options: ItineraryOption[];
  onChoose: (optionId: string) => void;
  choosingId: string | null;
  disabled: boolean;
  error: string | null;
}) {
  const cheapest = Math.min(...options.map((o) => o.estimatedTotalCents));
  const lookup = options[0]?.draft.reviewLookup;

  return (
    <section className="mt-8" aria-labelledby="options-heading">
      <h2 id="options-heading" className="text-sm font-semibold text-neutral-300">
        {options.length === 1
          ? "Your itinerary"
          : `${options.length} ways to do this trip — pick one`}
      </h2>
      <p className="mt-1 text-sm text-neutral-500">
        Choosing a plan doesn’t book or charge anything — you’ll get links to book each piece yourself.
      </p>

      {error && (
        <p role="alert" className="mt-3 text-sm text-amber-300">
          {error}
        </p>
      )}

      <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {options.map((option) => {
          const places = namedPlaces(option.draft.days);
          const delta = option.estimatedTotalCents - cheapest;
          const isChoosing = choosingId === option.id;
          const hotelExcerpt = places
            .find((p) => p.kind === "HOTEL" && p.review?.excerpts?.length)
            ?.review?.excerpts?.[0];

          return (
            <li
              key={option.id}
              className="flex flex-col rounded-xl border border-neutral-800 bg-neutral-950 p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-semibold leading-tight">{option.label}</h3>
                <span className="shrink-0 rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">
                  {PACE_LABELS[option.pace] ?? option.pace}
                </span>
              </div>

              <div className="mt-3">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xl font-semibold">
                    {fmt(option.estimatedTotalCents, option.currency)}
                  </span>
                  <span className="text-xs text-neutral-500">est. total</span>
                </div>
                <p className="mt-0.5 text-xs text-neutral-400">
                  {delta === 0
                    ? "Lowest estimate"
                    : `+${fmt(delta, option.currency)} vs cheapest`}
                </p>
              </div>

              <p className="mt-3 text-xs text-neutral-400">
                {option.draft.days.length} days · {countActivities(option.draft.days)}{" "}
                activities · {countBookables(option.draft.days)} to book
              </p>

              <p className="mt-3 text-sm text-neutral-300">{option.summary}</p>

              {places.length > 0 && (
                <ul className="mt-4 space-y-2 border-t border-neutral-800 pt-3">
                  {places.map((place, i) => (
                    <li key={`${place.kind}-${i}`} className="text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-neutral-200">
                          {place.review?.name ?? place.candidateName}
                          <span className="ml-1 text-xs uppercase tracking-wide text-neutral-500">
                            {place.kind === "HOTEL" ? "hotel" : "tour"}
                          </span>
                        </span>
                        <RatingBadge review={place.review} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {hotelExcerpt && (
                <blockquote className="mt-3 border-l-2 border-neutral-800 pl-3 text-xs italic text-neutral-400">
                  “{hotelExcerpt.text}”
                  {hotelExcerpt.authorName && (
                    <footer className="mt-1 not-italic text-neutral-500">
                      — {hotelExcerpt.authorName}
                      {hotelExcerpt.relativeTime ? `, ${hotelExcerpt.relativeTime}` : ""}
                    </footer>
                  )}
                </blockquote>
              )}

              <button
                type="button"
                onClick={() => onChoose(option.id)}
                disabled={disabled}
                className="mt-4 w-full rounded-lg bg-white py-2 text-sm font-medium text-neutral-900 disabled:opacity-40"
              >
                {isChoosing ? "Saving your plan…" : "Choose this plan"}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 space-y-1">
        <p className="text-xs text-neutral-500">
          Estimates for comparison. Real prices are on the booking sites we link you to.
        </p>
        {lookup && <ReviewNote lookup={lookup} />}
      </div>
    </section>
  );
}
