"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bot,
  CalendarDays,
  Compass,
  ExternalLink,
  FlaskConical,
  ListChecks,
  Loader2,
  MapPinOff,
  MessageCircleQuestion,
  RefreshCw,
  Send,
} from "lucide-react";
import { BudgetBar } from "../../components/BudgetBar";
import { ItineraryOptions, type ItineraryOption } from "../../components/ItineraryOptions";
import { BookingModePicker, type BookingMode } from "../../components/BookingModePicker";
import { ContourPattern } from "../../components/ContourPattern";
import { ItineraryTimeline } from "../../components/ItineraryTimeline";
import { Notifications } from "../../components/Notifications";
import { StatusPill } from "../../components/StatusPill";
import { Alert, INPUT_CLASSES, buttonClasses } from "../../components/ui";

type TripData = any; // the API route returns Prisma's shape directly; tighten with a shared type once it stabilizes.

export default function TripPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<TripData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [answering, setAnswering] = useState(false);
  const [options, setOptions] = useState<ItineraryOption[] | null>(null);
  const [choosingId, setChoosingId] = useState<string | null>(null);
  const [chooseError, setChooseError] = useState<string | null>(null);
  // "info" for the AI-mode "still working" message, which isn't a failure.
  const [chooseErrorTone, setChooseErrorTone] = useState<"danger" | "info">("danger");
  const answerRef = useRef<HTMLInputElement>(null);
  const clarificationId: string | undefined =
    data?.trip?.status === "DRAFT" || data?.trip?.status === "PLANNING"
      ? data?.trip?.notifications?.find((n: any) => n.kind === "CLARIFICATION_NEEDED" && !n.read)?.id
      : undefined;
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsReload, setOptionsReload] = useState(0);
  const [alreadyChosen, setAlreadyChosen] = useState(false);
  const [bookingMode, setBookingMode] = useState<BookingMode>("SELF");

  const tripStatus: string | undefined = data?.trip?.status;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/trips/${params.id}`);
        if (!res.ok) throw new Error(`Failed to load trip: ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load trip.");
      }
    }

    load();
    // Booking/planning happens server-side across multiple agent calls, so
    // the client polls rather than assuming the first response is final
    // (see frontend-dev.md: never a blank screen while an agent works).
    const interval = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [params.id]);

  // Options are fetched separately from the 4s trip poll: the full option
  // payload (every day of every option, plus review data) is far too heavy to
  // re-download every four seconds, and it only changes once.
  useEffect(() => {
    if (tripStatus !== "CHOOSING") return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/trips/${params.id}/options`);
        if (!res.ok) throw new Error(`Failed to load options: ${res.status}`);
        const json = await res.json();
        if (!cancelled) {
          setOptions(json.options ?? []);
          setOptionsError(null);
        }
      } catch (err) {
        // Must be its own state, not chooseError: chooseError only renders
        // inside <ItineraryOptions>, which isn't mounted while options are
        // null -- so routing this there left the page on a permanent spinner
        // with the error invisible and no way to retry.
        if (!cancelled) {
          setOptionsError(err instanceof Error ? err.message : "Failed to load your options.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.id, tripStatus, optionsReload]);

  // Move focus to the clarification input when a question first appears.
  useEffect(() => {
    if (clarificationId) answerRef.current?.focus();
  }, [clarificationId]);

  async function submitAnswer(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim()) return;
    setAnswering(true);
    try {
      await fetch(`/api/trips/${params.id}/clarify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      });
      setAnswer("");
    } finally {
      setAnswering(false);
    }
  }

  const chooseOption = useCallback(
    async (optionId: string) => {
      // The whole card set locks on the first click rather than relying on
      // the server's 409 to catch a double submit.
      setChoosingId(optionId);
      setChooseError(null);
      try {
        const res = await fetch(`/api/trips/${params.id}/choose`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ optionId, bookingMode }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (res.status === 409) {
            // Not an error from the user's point of view -- it's what happened.
            setAlreadyChosen(true);
          } else {
            setChooseErrorTone("danger");
            setChooseError(body.error ?? `Couldn't save your choice: ${res.status}`);
            setChoosingId(null);
          }
        }
        // On success the trip poll takes over: READY_TO_BOOK with links
        // (SELF), or BOOKING with per-item progress (AI).
      } catch {
        // In AI mode the request can outlive a proxy timeout while booking
        // carries on server-side, so this must NOT claim anything failed. The
        // trip poll is the source of truth; leave the cards locked.
        setChooseErrorTone("info");
        setChooseError(
          bookingMode === "AI"
            ? "Still working on this — bookings can take a few minutes. This page updates on its own."
            : "Still saving your plan — this page updates on its own.",
        );
      }
    },
    [params.id, bookingMode],
  );

  if (error) {
    return (
      <main id="main" className="mx-auto max-w-5xl px-6 py-16 md:px-8">
        <div className="mx-auto max-w-md rounded-2xl border border-sand-200 bg-white p-6 text-center shadow-card">
          <MapPinOff size={28} strokeWidth={1.75} aria-hidden="true" className="mx-auto text-danger-700" />
          <h1 className="mt-3 font-display text-2xl font-semibold text-ink-900">We couldn&apos;t load this trip</h1>
          <p role="alert" className="mt-2 text-sm text-ink-500">
            {error}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <button type="button" onClick={() => window.location.reload()} className={buttonClasses("primary")}>
              <RefreshCw size={16} strokeWidth={2} aria-hidden="true" />
              Try again
            </button>
            <Link href="/" className={buttonClasses("secondary")}>
              Plan a new trip
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main id="main" className="mx-auto max-w-5xl px-6 py-8 md:px-8">
        <p role="status" className="sr-only">
          Loading your trip…
        </p>
        <div aria-hidden="true" className="space-y-4">
          <div className="h-10 w-2/3 rounded-xl bg-sand-100 motion-safe:animate-pulse" />
          <div className="h-6 w-40 rounded-full bg-sand-100 motion-safe:animate-pulse" />
          <div className="mt-6 h-28 rounded-2xl bg-sand-100 motion-safe:animate-pulse" />
        </div>
      </main>
    );
  }

  const { trip, budget } = data;
  // Gated on status as well as the unread flag: nothing in the app marks
  // notifications read, so without the status check an answered clarification
  // prompt stays on screen forever -- and submitting it on a trip that has
  // already chosen an option is now rejected server-side anyway.
  const awaitingBrief = trip.status === "DRAFT" || trip.status === "PLANNING";
  const pendingClarification = awaitingBrief
    ? trip.notifications.find((n: any) => n.kind === "CLARIFICATION_NEEDED" && !n.read)
    : undefined;
  const isChoosing = trip.status === "CHOOSING";
  // The gap between claiming a choice and the day rows existing: without this
  // the page would briefly look empty under a "Booking…" pill.
  const settingUp =
    (trip.status === "READY_TO_BOOK" || trip.status === "BOOKING") && trip.itinerary.length === 0;
  const readyToBook = trip.status === "READY_TO_BOOK" && trip.itinerary.length > 0;
  const aiMode = trip.bookingMode === "AI";
  // A plan has been chosen once the itinerary exists or the trip has moved past choosing.
  const planChosen =
    trip.itinerary.length > 0 || ["READY_TO_BOOK", "BOOKING", "CONFIRMED"].includes(trip.status);
  // AI mode with sandbox providers: every confirmation/money surface says "test".
  const testMode = aiMode && !data.aiBooking?.live;
  const hasLinks = trip.itinerary.some((day: any) =>
    day.activities.some((a: any) => a.booking?.status === "LINK_OUT"),
  );
  const hasBookables = (options ?? []).some((o) =>
    o.draft.days.some((d) => d.activities.some((a) => a.bookable)),
  );
  const chosenLabel = options?.find((o) => o.id === choosingId)?.label;
  const planningFailed =
    trip.status === "NEEDS_ATTENTION" && trip.itinerary.length === 0 && !isChoosing;
  const dateRange = formatDateRange(trip.startDate, trip.endDate);
  const testSuffix = testMode ? " (test mode)" : "";

  const optionSkeletons = (
    <ul className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li key={i} className="overflow-hidden rounded-2xl border border-sand-200 bg-white shadow-card">
          <div className="h-10 bg-sand-100 motion-safe:animate-pulse" />
          <div className="space-y-3 p-5">
            <div className="h-6 w-3/4 rounded bg-sand-100 motion-safe:animate-pulse" />
            <div className="h-8 w-1/3 rounded bg-sand-100 motion-safe:animate-pulse" />
            <div className="h-3 w-full rounded bg-sand-100 motion-safe:animate-pulse" />
            <div className="h-3 w-full rounded bg-sand-100 motion-safe:animate-pulse" />
            <div className="h-3 w-2/3 rounded bg-sand-100 motion-safe:animate-pulse" />
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <main id="main">
      {/* Header band */}
      <div className="relative -mt-16 overflow-hidden pb-14 pt-24">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-sunrise [mask-image:linear-gradient(to_bottom,black_55%,transparent)]" />
        <ContourPattern opacity={0.05} />
        <div className="relative mx-auto max-w-5xl px-6 md:px-8">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="font-display text-4xl font-semibold tracking-tight text-ink-900">
              {trip.title ?? "Your trip"}
            </h1>
            <StatusPill status={trip.status} testMode={testMode} />
          </div>
          {(dateRange || trip.itinerary.length > 0 || planChosen) && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-medium text-ink-700">
              {(dateRange || trip.itinerary.length > 0) && (
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  <CalendarDays size={14} strokeWidth={1.75} aria-hidden="true" />
                  {dateRange}
                  {dateRange && trip.itinerary.length > 0 ? " · " : ""}
                  {trip.itinerary.length > 0 ? `${trip.itinerary.length} days` : ""}
                </span>
              )}
              {planChosen && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1">
                  {aiMode ? (
                    <Bot size={14} strokeWidth={1.75} aria-hidden="true" />
                  ) : (
                    <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
                  )}
                  {aiMode ? "AI booking" : "You’re booking"}
                </span>
              )}
              {planChosen && testMode && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-50 px-2.5 py-1 text-warning-700">
                  <FlaskConical size={14} strokeWidth={1.75} aria-hidden="true" />
                  Test mode
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 pb-24 md:px-8">
        <div className="-mt-6">
          <BudgetBar budget={budget} mode={planChosen ? (aiMode ? "AI" : "SELF") : null} testMode={testMode} />
        </div>

        {pendingClarification && (
          <form
            onSubmit={submitAnswer}
            aria-labelledby="clarify-question"
            aria-busy={answering}
            className="mt-6 rounded-2xl border border-l-4 border-sunset-600/30 border-l-sunset-600 bg-sunset-50 p-5"
          >
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-sunset-600">
              <MessageCircleQuestion size={16} strokeWidth={1.75} aria-hidden="true" />
              One quick question
            </p>
            <p id="clarify-question" className="mt-2 font-medium text-ink-900">
              {pendingClarification.message}
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <label htmlFor="clarify-answer" className="sr-only">
                Your answer
              </label>
              <input
                id="clarify-answer"
                ref={answerRef}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Your answer…"
                className={INPUT_CLASSES}
              />
              <button
                type="submit"
                disabled={answering || !answer.trim()}
                className={buttonClasses("primary", "shrink-0")}
              >
                {answering ? (
                  <>
                    <Loader2 size={16} strokeWidth={2} aria-hidden="true" className="motion-safe:animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Send size={16} strokeWidth={2} aria-hidden="true" />
                    Send
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {trip.status === "PLANNING" && (
          <section className="mt-12">
            <h2 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink-900">
              <Loader2 size={20} strokeWidth={1.75} aria-hidden="true" className="text-lagoon-600 motion-safe:animate-spin" />
              Drafting a few versions of this trip
            </h2>
            <p role="status" className="mt-2 text-ink-700">
              This takes a minute, and nothing is being booked.
            </p>
            {optionSkeletons}
          </section>
        )}

        {planningFailed && (
          <div className="mt-12 rounded-2xl border border-l-4 border-sand-200 border-l-warning-700 bg-white p-5 shadow-card">
            <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-ink-900">
              <AlertTriangle size={20} strokeWidth={1.75} aria-hidden="true" className="text-warning-700" />
              We couldn&apos;t draft options for this trip
            </h2>
            <p className="mt-2 text-sm text-ink-700">
              We couldn&apos;t draft itinerary options for this trip. Try again with different dates or
              budget.
            </p>
            <Link href="/" className={buttonClasses("secondary", "mt-4")}>
              Plan a new trip
            </Link>
          </div>
        )}

        {isChoosing && alreadyChosen && (
          <Alert tone="info" className="mt-12">
            A plan has already been chosen for this trip.{aiMode ? " Booking is underway." : ""}
          </Alert>
        )}

        {isChoosing &&
          !alreadyChosen &&
          (optionsError !== null ? (
            <Alert tone="danger" className="mt-12">
              <p>Couldn&apos;t load your itinerary options: {optionsError}</p>
              <p className="mt-1 text-ink-700">
                Your options are saved — this is just the page failing to fetch them.
              </p>
              <button
                type="button"
                onClick={() => {
                  setOptionsError(null);
                  setOptionsReload((n) => n + 1);
                }}
                className={buttonClasses("secondary", "mt-3 px-3.5 py-2")}
              >
                <RefreshCw size={16} strokeWidth={2} aria-hidden="true" />
                Try again
              </button>
            </Alert>
          ) : options === null ? (
            <section className="mt-12">
              <p role="status" className="text-ink-700">
                Loading your options…
              </p>
              {optionSkeletons}
            </section>
          ) : options.length === 0 ? (
            <Alert tone="warning" className="mt-12" icon={<Compass size={18} strokeWidth={1.75} aria-hidden="true" />}>
              No itinerary options are available for this trip yet.
            </Alert>
          ) : (
            <ItineraryOptions
              bookingMode={bookingMode}
              options={options}
              onChoose={chooseOption}
              choosingId={choosingId}
              disabled={choosingId !== null}
              error={chooseError}
              errorTone={chooseErrorTone}
              modePicker={
                hasBookables ? (
                  <BookingModePicker
                    value={bookingMode}
                    onChange={setBookingMode}
                    readiness={data.aiBooking}
                    disabled={choosingId !== null}
                  />
                ) : undefined
              }
            />
          ))}

        {settingUp && (
          <Alert
            tone="info"
            className="mt-8"
            icon={<Loader2 size={18} strokeWidth={1.75} aria-hidden="true" className="motion-safe:animate-spin" />}
          >
            {aiMode
              ? `Setting up ${chosenLabel ? `“${chosenLabel}”` : "your plan"} and starting on flights, hotels, and activities…${testSuffix}`
              : `Saving ${chosenLabel ? `“${chosenLabel}”` : "your plan"}…`}
          </Alert>
        )}
        {readyToBook && !hasLinks && (
          <Alert tone="success" className="mt-8">
            Your plan is set. Nothing in it needs booking.
          </Alert>
        )}
        {readyToBook && hasLinks && (
          <Alert tone="info" className="mt-8" icon={<ListChecks size={18} strokeWidth={1.75} aria-hidden="true" />}>
            <p className="font-medium">Your plan is ready to book.</p>
            <p className="mt-1 text-ink-700">
              We don&apos;t book anything for you. Use the links beside each flight, hotel, and tour to book
              it yourself; they open the provider&apos;s site with your dates filled in where the site
              supports it. Prices there are the real ones; ours are estimates.
            </p>
          </Alert>
        )}
        {trip.status === "BOOKING" && trip.itinerary.length > 0 && (
          <Alert
            tone="info"
            className="mt-8"
            icon={
              aiMode ? (
                <Loader2 size={18} strokeWidth={1.75} aria-hidden="true" className="motion-safe:animate-spin" />
              ) : undefined
            }
          >
            {aiMode
              ? `Plan locked in — the AI is booking your flights, hotel, and activities…${testSuffix}`
              : "This trip was planned before the app switched to booking links, so it has no links. Plan a new trip to get them."}
          </Alert>
        )}

        {trip.itinerary.length > 0 && (
          <section aria-labelledby="itinerary-heading" className="mt-12">
            <h2 id="itinerary-heading" className="font-display text-2xl font-semibold text-ink-900">
              Your itinerary
            </h2>
            <ItineraryTimeline days={trip.itinerary} aiMode={aiMode} testMode={testMode} />
          </section>
        )}

        <Notifications notifications={trip.notifications} unreadCount={data.unreadCount ?? 0} testMode={testMode} />
      </div>
    </main>
  );
}

function formatDateRange(start?: string | null, end?: string | null): string {
  if (!start) return "";
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  const s = new Date(start);
  if (!end) return s.toLocaleDateString("en-US", { ...opts, year: "numeric" });
  const e = new Date(end);
  return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString("en-US", { ...opts, year: "numeric" })}`;
}
