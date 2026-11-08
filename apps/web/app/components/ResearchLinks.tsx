import { ExternalLink } from "lucide-react";

type Link = { provider: string; url: string };

// "See what people say": Google + Reddit searches for a place, so travellers
// can vet it on sources they already trust. Quiet text links on purpose --
// they're for checking, and mustn't compete with the booking buttons. URLs
// come from packages/core/src/researchLinks.ts (deterministic, never model-written).
export function ResearchLinks({ links, subject }: { links?: Link[]; subject: string }) {
  if (!links || links.length === 0) return null;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-500">
      <span>See what people say:</span>
      {links.map((link, i) => (
        <span key={link.provider} className="inline-flex items-center gap-1.5">
          {i > 0 && <span aria-hidden="true">·</span>}
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`See what people say about ${subject} on ${link.provider} (opens in a new tab)`}
            className="inline-flex items-center gap-0.5 rounded font-medium text-lagoon-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lagoon-600"
          >
            {link.provider}
            <ExternalLink size={12} strokeWidth={2} aria-hidden="true" />
          </a>
        </span>
      ))}
    </p>
  );
}
