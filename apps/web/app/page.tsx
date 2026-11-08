"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Columns3,
  ExternalLink,
  Heart,
  Loader2,
  MessageSquareText,
  Mountain,
  ShieldCheck,
  Sparkles,
  Sun,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { ContourPattern } from "./components/ContourPattern";
import { Alert, CHIP_CLASSES, buttonClasses } from "./components/ui";

// "Surprise me" first on purpose: it's the "I don't know what I want" path.
const EXAMPLES: Array<{ Icon: LucideIcon; text: string }> = [
  { Icon: Sun, text: "Surprise me, somewhere warm" },
  { Icon: UtensilsCrossed, text: "A long food weekend in Lisbon, around $1,500" },
  { Icon: Heart, text: "Relaxed week with my partner in March, $2,500" },
  { Icon: Wallet, text: "Mexico City on a tight budget" },
  { Icon: Mountain, text: "Somewhere quiet with hiking, 5 days" },
];

const STEPS: Array<{ Icon: LucideIcon; title: string; body: string }> = [
  { Icon: MessageSquareText, title: "Describe it", body: "Any detail you have, or none at all." },
  {
    Icon: Columns3,
    title: "Compare real options",
    body: "Value, balanced and elevated takes, each with an estimated cost.",
  },
  {
    Icon: ExternalLink,
    title: "Book it your way",
    body: "Get a ready-made search link for every piece, or let the AI book it within your budget.",
  },
];

export default function HomePage() {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
      setSubmitting(false);
    }
  }

  // Fill and focus, never submit: the user can still edit, and submitting spends model calls.
  function applyExample(text: string) {
    setPrompt(text);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(text.length, text.length);
    });
  }

  return (
    <main id="main">
      <section className="relative -mt-16 overflow-hidden pb-16 pt-28 md:pt-32">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-sunrise [mask-image:linear-gradient(to_bottom,black_55%,transparent)]" />
        <ContourPattern />
        <div className="relative mx-auto flex max-w-3xl flex-col items-center px-6 text-center md:px-8">
          <span className="inline-flex items-center gap-2 rounded-full border border-sand-200 bg-white/70 px-3.5 py-1.5 text-sm text-ink-700">
            <Sparkles size={16} strokeWidth={1.75} aria-hidden="true" className="text-sunset-600" />
            Describe it. Compare options. Book it your way.
          </span>

          <h1 className="mt-6 font-display text-5xl font-medium tracking-tight text-ink-900 md:text-6xl">
            Tell us the feeling.
            <br />
            <em className="text-sunset-600">We&apos;ll find the trip.</em>
          </h1>

          <p className="mt-6 max-w-xl text-lg text-ink-700">
            Not sure where to go? Say so. We&apos;ll draft a few options with estimated costs side by
            side. Then book each piece yourself from ready-made links, or let our AI book it for you.
          </p>

          <form
            onSubmit={handleSubmit}
            aria-busy={submitting}
            className="mt-10 w-full max-w-2xl rounded-3xl border border-sand-200 bg-white p-2 text-left shadow-lift focus-within:ring-2 focus-within:ring-lagoon-600/40"
          >
            <label htmlFor="trip-prompt" className="sr-only">
              Describe your trip
            </label>
            <textarea
              id="trip-prompt"
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              readOnly={submitting}
              placeholder={
                'e.g. "I want a relaxed week somewhere warm in March, traveling with my ' +
                'partner, budget around $2500" — or just "surprise me, I need a break."'
              }
              rows={4}
              className="w-full resize-none border-0 bg-transparent p-4 text-lg text-ink-900 placeholder:text-ink-500 focus:outline-none focus:ring-0"
            />
            <div className="flex flex-col gap-3 border-t border-sand-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-1.5 text-sm text-ink-500">
                <ShieldCheck size={16} strokeWidth={1.75} aria-hidden="true" />
                Nothing is booked unless you ask us to.
              </p>
              <button
                type="submit"
                disabled={submitting || !prompt.trim()}
                className={buttonClasses("primary")}
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} strokeWidth={2} aria-hidden="true" className="motion-safe:animate-spin" />
                    Drafting your options…
                  </>
                ) : (
                  <>
                    Plan my trip
                    <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
                  </>
                )}
              </button>
            </div>
          </form>

          {error && (
            <Alert tone="danger" className="mt-4 w-full max-w-2xl text-left">
              {error}
            </Alert>
          )}

          <div className="mt-8 w-full max-w-2xl">
            <p className="text-xs font-medium text-ink-500">Or start from one of these</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {EXAMPLES.map(({ Icon, text }) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => applyExample(text)}
                  disabled={submitting}
                  className={CHIP_CLASSES}
                >
                  <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                  {text}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="how-heading" className="mx-auto max-w-5xl px-6 pb-24 pt-8 md:px-8">
        <h2 id="how-heading" className="sr-only">
          How it works
        </h2>
        <ol className="grid gap-8 md:grid-cols-3">
          {STEPS.map(({ Icon, title, body }) => (
            <li key={title} className="flex flex-col items-center text-center md:items-start md:text-left">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-lagoon-50 text-lagoon-700">
                <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <h3 className="mt-4 font-display text-xl font-semibold text-ink-900">{title}</h3>
              <p className="mt-1 text-sm text-ink-700">{body}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
