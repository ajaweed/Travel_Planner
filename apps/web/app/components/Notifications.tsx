import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Columns3,
  FlaskConical,
  Info,
  MessageCircleQuestion,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { CARD_CLASSES } from "./ui";

// "Updates" feed (docs/visual-design.md §4.4). Newest first, as the API returns.

type Notification = { id: string; kind: string; message: string; createdAt: string };

const KINDS: Record<string, { Icon: LucideIcon; tile: string }> = {
  ITINERARY_READY: { Icon: Columns3, tile: "bg-lagoon-50 text-lagoon-700" },
  CLARIFICATION_NEEDED: { Icon: MessageCircleQuestion, tile: "bg-sunset-50 text-sunset-600" },
  BOOKING_CONFIRMED: { Icon: CheckCircle2, tile: "bg-success-50 text-success-700" },
  BOOKING_FAILED: { Icon: XCircle, tile: "bg-danger-50 text-danger-700" },
  BUDGET_ALERT: { Icon: AlertTriangle, tile: "bg-warning-50 text-warning-700" },
};
const FALLBACK = { Icon: Info, tile: "bg-sand-100 text-ink-700" };

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function relativeTime(iso: string, now: number): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(seconds, "second");
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  return rtf.format(Math.round(seconds / 86400), "day");
}

export function Notifications({
  notifications,
  testMode,
}: {
  notifications: Notification[];
  testMode: boolean;
}) {
  const now = Date.now();
  return (
    <section aria-labelledby="updates-heading" className="mt-12">
      <h2 id="updates-heading" className="flex items-center gap-2 font-display text-2xl font-semibold text-ink-900">
        Updates
      </h2>
      {/* Only the newest message is live. Wrapping the whole feed made screen
          readers re-announce every relative timestamp on each 4s poll. No unread
          badge: nothing marks notifications read, so it could only ever grow. */}
      <p aria-live="polite" className="sr-only">
        {notifications[0]?.message ?? ""}
      </p>
      <div className="mt-4">
        {notifications.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-ink-500">
            <Bell size={16} strokeWidth={1.75} aria-hidden="true" />
            No updates yet. We&apos;ll post here as your plan comes together.
          </p>
        ) : (
          <ul className={`divide-y divide-sand-100 overflow-hidden ${CARD_CLASSES}`}>
            {notifications.map((n) => {
              const { Icon, tile } = KINDS[n.kind] ?? FALLBACK;
              return (
                <li key={n.id} className="flex gap-3 p-4">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tile}`}>
                    <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink-900">
                      {n.message}
                      {testMode && n.kind === "BOOKING_CONFIRMED" && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-warning-50 px-2 py-0.5 align-middle text-xs font-medium text-warning-700">
                          <FlaskConical size={12} strokeWidth={2} aria-hidden="true" />
                          Test
                        </span>
                      )}
                    </p>
                    <time
                      dateTime={n.createdAt}
                      title={new Date(n.createdAt).toLocaleString()}
                      className="mt-0.5 block text-xs text-ink-500"
                    >
                      {relativeTime(n.createdAt, now)}
                    </time>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
