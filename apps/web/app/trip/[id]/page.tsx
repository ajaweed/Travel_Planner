"use client";

import { useCallback, useEffect, useState } from "react";
import { BudgetBar } from "../../components/BudgetBar";
import { ItineraryOptions, type ItineraryOption } from "../../components/ItineraryOptions";
import { BookingLinks } from "../../components/BookingLinks";
import { StatusPill } from "../../components/StatusPill";

type TripData = any; // the API route returns Prisma's shape directly; tighten with a shared type once it stabilizes.

export default function TripPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<TripData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [answering, setAnswering] = useState(false);
  const [options, setOptions] = useState<ItineraryOption[] | null>(null);
  const [choosingId, setChoosingId] = useState<string | null>(null);
  const [chooseError, setChooseError] = useState<string | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsReload, setOptionsReload] = useState(0);
  const [alreadyChosen, setAlreadyChosen] = useState(false);

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
          body: JSON.stringify({ optionId }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (res.status === 409) {
            // Not an error from the user's point of view -- it's what happened.
            setAlreadyChosen(true);
          } else {
            setChooseError(body.error ?? `Couldn't save your choice: ${res.status}`);
            setChoosingId(null);
          }
        }
        // On success the trip poll takes over: status is READY_TO_BOOK and
        // the itinerary appears with booking links.
      } catch {
        // A network drop doesn't mean the choice failed server-side. The trip
        // poll is the source of truth; leave the cards locked.
        setChooseError("Still saving your plan — this page updates on its own.");
      }
    },
    [params.id],
  );

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-red-400">{error}</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-neutral-400">Loading your trip…</p>
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
  const hasLinks = trip.itinerary.some((day: any) =>
    day.activities.some((a: any) => a.booking?.status === "LINK_OUT"),
  );
  const chosenLabel = options?.find((o) => o.id === choosingId)?.label;
  const planningFailed =
    trip.status === "NEEDS_ATTENTION" && trip.itinerary.length === 0 && !isChoosing;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{trip.title ?? "Your trip"}</h1>
        <StatusPill status={trip.status} />
      </div>

      <div className="mt-6">
        <BudgetBar budget={budget} />
      </div>

      {pendingClarification && (
        <form onSubmit={submitAnswer} className="mt-6 rounded-xl border border-amber-700 bg-amber-950/40 p-4">
          <p className="text-sm font-medium text-amber-200">{pendingClarification.message}</p>
          <div className="mt-3 flex gap-2">
            <input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Your answer…"
              className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
            <button
              type="submit"
              disabled={answering || !answer.trim()}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-40"
            >
              {answering ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      )}

      {trip.status === "PLANNING" && (
        <div className="mt-8">
          <p className="text-sm text-neutral-400">
            Drafting a few different versions of this trip… This takes a minute.
          </p>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="h-52 animate-pulse rounded-xl border border-neutral-800 bg-neutral-900/50" />
            ))}
          </ul>
        </div>
      )}

      {planningFailed && (
        <p className="mt-8 text-sm text-amber-300">
          We couldn&apos;t draft itinerary options for this trip. Try again with different dates
          or budget.
        </p>
      )}

      {isChoosing && alreadyChosen && (
        <p className="mt-8 text-sm text-neutral-300">
          A plan has already been chosen for this trip.
        </p>
      )}

      {isChoosing &&
        !alreadyChosen &&
        (optionsError !== null ? (
          <div className="mt-8">
            <p role="alert" className="text-sm text-amber-300">
              Couldn&apos;t load your itinerary options: {optionsError}
            </p>
            <p className="mt-1 text-sm text-neutral-500">
              Your options are saved — this is just the page failing to fetch them.
            </p>
            <button
              type="button"
              onClick={() => {
                setOptionsError(null);
                setOptionsReload((n) => n + 1);
              }}
              className="mt-3 rounded-lg bg-white px-4 py-2 text-sm font-medium text-neutral-900"
            >
              Try again
            </button>
          </div>
        ) : options === null ? (
          <p className="mt-8 text-sm text-neutral-400">Loading your options…</p>
        ) : options.length === 0 ? (
          <p className="mt-8 text-sm text-amber-300">
            No itinerary options are available for this trip yet.
          </p>
        ) : (
          <ItineraryOptions
            options={options}
            onChoose={chooseOption}
            choosingId={choosingId}
            disabled={choosingId !== null}
            error={chooseError}
          />
        ))}

      {settingUp && (
        <p className="mt-8 text-sm text-neutral-400">
          Setting up {chosenLabel ? `“${chosenLabel}”` : "your plan"}…
        </p>
      )}
      {readyToBook && !hasLinks && (
        <p className="mt-6 text-sm text-neutral-400">
          Your plan is set. Nothing in it needs booking.
        </p>
      )}
      {readyToBook && hasLinks && (
        <div className="mt-6 rounded-xl border border-emerald-800 bg-emerald-950/40 p-4">
          <p className="text-sm font-medium text-emerald-200">Your plan is ready to book.</p>
          <p className="mt-1 text-sm text-neutral-400">
            We don&apos;t book anything for you. Use the links beside each flight, hotel, and tour
            to book it yourself; they open the provider&apos;s site with your dates filled in where
            the site supports it. Prices there are the real ones; ours are estimates.
          </p>
        </div>
      )}
      {trip.status === "BOOKING" && trip.itinerary.length > 0 && (
        <p className="mt-6 text-sm text-neutral-400">
          This trip was planned before the app switched to booking links, so it has no
          links. Plan a new trip to get them.
        </p>
      )}

      {trip.itinerary.length > 0 && (
        <div className="mt-8 space-y-6">
          {trip.itinerary.map((day: any) => (
            <div key={day.id} className="rounded-xl border border-neutral-800 p-4">
              <h2 className="text-sm font-semibold text-neutral-300">
                Day {day.dayIndex + 1}
                {day.date ? ` — ${new Date(day.date).toLocaleDateString()}` : ""}
              </h2>
              {day.summary && <p className="mt-1 text-sm text-neutral-500">{day.summary}</p>}
              <ul className="mt-3 space-y-2">
                {day.activities.map((activity: any) => (
                  <li key={activity.id} className="flex items-start justify-between gap-3 text-sm">
                    <div>
                      <span className="font-medium">{activity.title}</span>
                      {activity.description && (
                        <p className="text-neutral-500">{activity.description}</p>
                      )}
                    </div>
                    {activity.booking?.status === "LINK_OUT" ? (
                      <BookingLinks links={activity.booking.links ?? []} title={activity.title} />
                    ) : (
                      activity.booking && <StatusPill status={activity.booking.status} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div className="mt-10">
        <h2 className="text-sm font-semibold text-neutral-300">Notifications</h2>
        <ul className="mt-2 space-y-1">
          {trip.notifications.map((n: any) => (
            <li key={n.id} className="text-sm text-neutral-400">
              {n.message}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
