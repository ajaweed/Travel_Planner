"use client";

import { useEffect, useState } from "react";
import { BudgetBar } from "../../components/BudgetBar";
import { StatusPill } from "../../components/StatusPill";

type TripData = any; // the API route returns Prisma's shape directly; tighten with a shared type once it stabilizes.

export default function TripPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<TripData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [answering, setAnswering] = useState(false);

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
  const pendingClarification = trip.notifications.find(
    (n: any) => n.kind === "CLARIFICATION_NEEDED" && !n.read,
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
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
        <p className="mt-6 text-sm text-neutral-400">Building your itinerary…</p>
      )}
      {trip.status === "BOOKING" && (
        <p className="mt-6 text-sm text-neutral-400">Itinerary ready — booking flights, hotels, and activities…</p>
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
                    {activity.booking && <StatusPill status={activity.booking.status} />}
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
