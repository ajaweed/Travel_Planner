import { ExternalLink, Unlink } from "lucide-react";

type Link = { provider: string; url: string; note?: string };

// "Book it yourself" link-outs (docs/visual-design.md §4.7). URLs are built
// server-side from structured trip data (packages/core/src/bookingLinks.ts),
// never written by the model. Real <a> elements so middle-click / copy-link /
// open-in-new-tab all work.
export function BookingLinks({
  links,
  title,
  eyebrow = "Book it yourself",
}: {
  links: Link[];
  title: string;
  /** "Book it yourself instead" for the AI-mode fallback. */
  eyebrow?: string;
}) {
  if (links.length === 0) {
    // Honest no-link state: never a disabled button or a guessed link.
    return (
      <p className="flex items-center gap-1.5 text-sm text-ink-500">
        <Unlink size={16} strokeWidth={1.75} aria-hidden="true" />
        No search link for this item.
      </p>
    );
  }
  const notes = links.flatMap((l) => (l.note ? [l.note] : []));
  return (
    <div className="flex flex-col gap-1.5 sm:items-end">
      <span className="text-xs font-medium text-ink-500">{eyebrow}</span>
      <div className="flex flex-wrap gap-2 sm:justify-end">
        {links.map((link) => (
          <a
            key={link.provider}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Search on ${link.provider} for ${title} (opens in a new tab)`}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-white px-3.5 py-2 text-sm font-semibold text-lagoon-700 ring-1 ring-inset ring-sand-400 hover:bg-lagoon-50 hover:ring-lagoon-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lagoon-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white motion-safe:transition-colors"
          >
            Search on {link.provider}
            <ExternalLink size={16} strokeWidth={1.75} aria-hidden="true" />
          </a>
        ))}
      </div>
      {notes.map((note) => (
        <p key={note} className="text-xs text-ink-500">
          {note}
        </p>
      ))}
    </div>
  );
}
