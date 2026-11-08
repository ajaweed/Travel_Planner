"use client";

import { ArrowUpRight } from "lucide-react";
import { PhotoCredit, PhotoFill, useDestinationPhoto } from "./DestinationPhoto";
import { FOCUS_RING } from "./ui";

// Starting points, not recommendations or rankings: no "popular", no counts
// (no fabricated social proof, docs/visual-design.md §3). Each photo is of
// the place named on the card.
const IDEAS: Array<{ place: string; label: string; prompt: string }> = [
  { place: "Lisbon", label: "Lisbon", prompt: "A long food weekend in Lisbon, around $1,500" },
  { place: "Kyoto", label: "Kyoto", prompt: "A week in Kyoto for temples and gardens, mid-range budget" },
  { place: "Mexico City", label: "Mexico City", prompt: "Mexico City on a tight budget, 5 days" },
  { place: "Marrakesh", label: "Marrakesh", prompt: "Four days in Marrakesh with a riad stay, around $1,200" },
  { place: "Banff National Park", label: "Banff", prompt: "Somewhere quiet with hiking: 5 days around Banff" },
  { place: "Cape Town", label: "Cape Town", prompt: "Ten days in Cape Town with a partner, beaches and wine" },
];

function IdeaCard({
  place,
  label,
  prompt,
  onPick,
  disabled,
}: (typeof IDEAS)[number] & { onPick: (prompt: string) => void; disabled?: boolean }) {
  const state = useDestinationPhoto(place);
  return (
    <li className="flex flex-col">
      <button
        type="button"
        onClick={() => onPick(prompt)}
        disabled={disabled}
        className={`group relative h-44 overflow-hidden rounded-2xl text-left shadow-card motion-safe:transition-shadow hover:shadow-lift disabled:cursor-not-allowed md:h-52 ${FOCUS_RING}`}
      >
        <PhotoFill state={state} sizes="(min-width: 1024px) 320px, (min-width: 640px) 50vw, 100vw" className="motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-105" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-900/80 via-ink-900/20 to-transparent" />
        <span className="absolute inset-x-0 bottom-0 p-4">
          <span className="flex items-center justify-between font-display text-xl font-semibold text-white">
            {label}
            <ArrowUpRight size={18} strokeWidth={2} aria-hidden="true" className="opacity-80 group-hover:opacity-100" />
          </span>
          <span className="mt-0.5 line-clamp-2 block text-sm text-white/90">{prompt}</span>
        </span>
      </button>
      <PhotoCredit photo={state.status === "ready" ? state.photo : null} className="mt-1.5 px-1" />
    </li>
  );
}

export function DestinationIdeas({ onPick, disabled }: { onPick: (prompt: string) => void; disabled?: boolean }) {
  return (
    <section aria-labelledby="ideas-heading" className="mx-auto max-w-5xl px-6 pb-16 md:px-8">
      <h2 id="ideas-heading" className="font-display text-2xl font-semibold text-ink-900">
        Need a starting point?
      </h2>
      <p className="mt-1 text-sm text-ink-700">Pick one to fill in the box above, then make it yours.</p>
      <ul className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {IDEAS.map((idea) => (
          <IdeaCard key={idea.place} {...idea} onPick={onPick} disabled={disabled} />
        ))}
      </ul>
    </section>
  );
}
