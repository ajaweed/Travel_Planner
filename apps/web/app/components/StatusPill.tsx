import {
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  Circle,
  Columns3,
  Flag,
  FlaskConical,
  HandCoins,
  ListChecks,
  Loader2,
  PencilLine,
  XCircle,
  type LucideIcon,
} from "lucide-react";

// Trip-level and per-booking statuses (docs/visual-design.md §4.6). Every
// status is an icon AND a word -- color is never the only signal.

type PillStyle = { label: string; classes: string; Icon: LucideIcon; spin?: boolean };

const STYLES: Record<string, PillStyle> = {
  // Trip statuses
  DRAFT: { label: "Draft", classes: "bg-sand-100 text-ink-700", Icon: PencilLine },
  PLANNING: { label: "Planning…", classes: "bg-lagoon-50 text-lagoon-700", Icon: Loader2, spin: true },
  CHOOSING: { label: "Choose a plan", classes: "bg-lagoon-600 text-white", Icon: Columns3 },
  // Deliberately lagoon, not success-green: the user still has everything to book.
  READY_TO_BOOK: { label: "Plan ready", classes: "bg-lagoon-50 text-lagoon-700", Icon: ListChecks },
  BOOKING: { label: "Booking…", classes: "bg-info-50 text-info-700", Icon: Loader2, spin: true },
  CONFIRMED: { label: "Confirmed", classes: "bg-success-50 text-success-700", Icon: CheckCircle2 },
  NEEDS_ATTENTION: { label: "Needs your input", classes: "bg-warning-50 text-warning-700", Icon: AlertTriangle },
  COMPLETED: { label: "Completed", classes: "bg-sand-100 text-ink-700", Icon: Flag },
};

const BOOKING_STYLES: Record<string, PillStyle> = {
  SEARCHING: { label: "Searching…", classes: "bg-info-50 text-info-700", Icon: Loader2, spin: true },
  OPTIONS_FOUND: { label: "Options found", classes: "bg-info-50 text-info-700", Icon: ListChecks },
  AWAITING_CONFIRMATION: { label: "Needs your input", classes: "bg-warning-50 text-warning-700", Icon: HandCoins },
  BOOKED: { label: "Booked", classes: "bg-success-50 text-success-700", Icon: Check },
  // "Not booked" says what the user needs to know, and pairs with the fallback link.
  FAILED: { label: "Not booked", classes: "bg-danger-50 text-danger-700", Icon: XCircle },
  CANCELLED: { label: "Cancelled", classes: "bg-sand-100 text-ink-500", Icon: Ban },
};

export function StatusPill({
  status,
  kind = "trip",
  testMode = false,
}: {
  status: string;
  kind?: "trip" | "booking";
  /** AI mode with sandbox providers: confirmations must never read as real. */
  testMode?: boolean;
}) {
  const style = (kind === "booking" ? BOOKING_STYLES : STYLES)[status] ?? {
    label: status,
    classes: "bg-sand-100 text-ink-700",
    Icon: Circle,
  };
  const isConfirmation = status === "CONFIRMED" || status === "BOOKED";
  const label = testMode && isConfirmation ? `${style.label} (test)` : style.label;
  const Icon = style.Icon;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${style.classes}`}
    >
      <Icon
        size={14}
        strokeWidth={2}
        aria-hidden="true"
        className={style.spin ? "motion-safe:animate-spin" : undefined}
      />
      {label}
      {testMode && isConfirmation && <FlaskConical size={14} strokeWidth={2} aria-hidden="true" />}
    </span>
  );
}
