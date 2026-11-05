"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed: ${res.status}`);
      }
      const data = await res.json();
      router.push(`/trip/${data.tripId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Trip Planner AI</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Don&apos;t know where to start? Just tell us what you&apos;re looking for.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="w-full">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            'e.g. "I want a relaxed week somewhere warm in March, traveling with my ' +
            'partner, budget around $2500" — or just "surprise me, I need a break."'
          }
          rows={4}
          className="w-full resize-none rounded-xl border border-neutral-700 bg-neutral-900 p-4 text-base outline-none focus:border-neutral-400"
        />
        <button
          type="submit"
          disabled={submitting || !prompt.trim()}
          className="mt-3 w-full rounded-xl bg-white py-3 font-medium text-neutral-900 disabled:opacity-40"
        >
          {submitting ? "Planning..." : "Plan my trip"}
        </button>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </form>
    </main>
  );
}
