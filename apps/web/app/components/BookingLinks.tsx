type Link = { provider: string; url: string; note?: string };

// Link-out booking: the app never books for the traveller. Each bookable
// activity gets provider search links (built server-side from structured trip
// data in packages/core/src/bookingLinks.ts, never model-written URLs).
export function BookingLinks({ links, title }: { links: Link[]; title: string }) {
  if (links.length === 0) return null;
  const notes = links.flatMap((l) => (l.note ? [l.note] : []));
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
    <div className="flex flex-wrap justify-end gap-1.5">
      {links.map((link) => (
        <a
          key={link.provider}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Book ${title} on ${link.provider} (opens in a new tab)`}
          className="whitespace-nowrap rounded-full border border-neutral-600 px-2.5 py-0.5 text-xs font-medium text-neutral-200 hover:border-neutral-300 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
        >
          {link.provider} <span aria-hidden="true">↗</span>
        </a>
      ))}
    </div>
    {notes.map((note) => (
      <p key={note} className="text-xs text-neutral-500">
        {note}
      </p>
    ))}
    </div>
  );
}
