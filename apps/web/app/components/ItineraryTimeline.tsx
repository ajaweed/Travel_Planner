"use client";

import { useState } from "react";
import {
  AlertTriangle,
  BedDouble,
  CheckCircle2,
  Copy,
  MapPin,
  Plane,
  Ticket,
  type LucideIcon,
} from "lucide-react";
import { BookingLinks } from "./BookingLinks";
import { StatusPill } from "./StatusPill";
import { CARD_CLASSES, fmtMoney } from "./ui";

// The chosen itinerary as a vertical timeline (docs/visual-design.md §4.3,
// §4.9). SELF rows carry link-outs; AI rows carry per-item booking state plus
// the link fallback on anything not booked.

type Link = { provider: string; url: string; note?: string };
type Booking = {
  id: string;
  kind: string;
  status: string;
  providerRef?: string | null;
  priceCents?: number | null;
  currency?: string | null;
  failureReason?: string | null;
  links?: Link[];
};
type Activity = {
  id: string;
  title: string;
  description?: string | null;
  startTime?: string | null;
  booking?: Booking | null;
};
type Day = { id: string; dayIndex: number; date?: string | null; summary?: string | null; activities: Activity[] };

const KIND_ICONS: Record<string, LucideIcon> = { FLIGHT: Plane, HOTEL: BedDouble, TOUR: Ticket };

function fmtDay(iso: string) {
  // Day dates are stored as UTC midnight; format in UTC so they don't shift a day.
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Agent failure reasons can be paragraphs with markdown emphasis; keep them readable. */
function plainReason(reason: string) {
  return reason.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

function DayChip({ day, aiMode }: { day: Day; aiMode: boolean }) {
  const bookings = day.activities.flatMap((a) => (a.booking ? [a.booking] : []));
  if (bookings.length === 0) return null;
  const chip = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums";
  if (!aiMode) {
    return (
      <span className={`${chip} bg-sand-100 text-ink-700`}>
        <Ticket size={14} strokeWidth={1.75} aria-hidden="true" />
        {bookings.length} to book
      </span>
    );
  }
  const needsYou = bookings.filter((b) => b.status === "FAILED" || b.status === "AWAITING_CONFIRMATION").length;
  if (needsYou > 0) {
    return (
      <span className={`${chip} bg-warning-50 text-warning-700`}>
        <AlertTriangle size={14} strokeWidth={1.75} aria-hidden="true" />
        {needsYou} need{needsYou === 1 ? "s" : ""} you
      </span>
    );
  }
  const booked = bookings.filter((b) => b.status === "BOOKED").length;
  return (
    <span className={`${chip} bg-sand-100 text-ink-700`}>
      <CheckCircle2 size={14} strokeWidth={1.75} aria-hidden="true" />
      {booked} of {bookings.length} booked
    </span>
  );
}

function CopyRef({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Copy confirmation reference"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            /* clipboard blocked: the ref is still visible to copy by hand */
          }
        }}
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-500 hover:bg-sand-100 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lagoon-600"
      >
        <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <span aria-live="polite" className="text-xs text-success-700">
        {copied ? "Copied" : ""}
      </span>
    </>
  );
}

function AiBookingDetail({ booking, testMode }: { booking: Booking; testMode: boolean }) {
  const [open, setOpen] = useState(false);
  switch (booking.status) {
    case "SEARCHING":
      return <p className="text-sm text-ink-500">Searching providers…</p>;
    case "BOOKED":
      return (
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-ink-700 tabular-nums">
          Confirmation
          {booking.providerRef ? (
            <>
              <span className="font-mono text-ink-900">{booking.providerRef}</span>
              <CopyRef value={booking.providerRef} />
            </>
          ) : (
            <span className="text-ink-500">reference not provided</span>
          )}
          {booking.priceCents != null && booking.currency && (
            <span>· {fmtMoney(booking.priceCents, booking.currency, false)}</span>
          )}
          {testMode && <span className="text-warning-700">· Test booking, not a real reservation</span>}
        </p>
      );
    case "AWAITING_CONFIRMATION":
      return (
        <p className="text-sm font-medium text-ink-900 tabular-nums">
          {booking.priceCents != null && booking.currency
            ? `${fmtMoney(booking.priceCents, booking.currency)} is more than your remaining budget, so the AI didn’t book it.`
            : "This is more than your remaining budget, so the AI didn’t book it."}
        </p>
      );
    case "FAILED": {
      const reason = booking.failureReason ? plainReason(booking.failureReason) : "No reason was given.";
      const long = reason.length > 160;
      return (
        <div className="text-sm text-danger-700">
          <p className={long && !open ? "line-clamp-2" : ""}>Not booked: {reason}</p>
          {long && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="mt-0.5 rounded text-sm font-medium text-lagoon-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lagoon-600"
            >
              {open ? "Show less" : "Show full reason"}
            </button>
          )}
        </div>
      );
    }
    case "CANCELLED":
      return <p className="text-sm text-ink-500">Cancelled</p>;
    default:
      return null;
  }
}

function ActivityRow({ activity, aiMode, testMode }: { activity: Activity; aiMode: boolean; testMode: boolean }) {
  const booking = activity.booking;
  const Icon = (booking && KIND_ICONS[booking.kind]) || MapPin;
  const linkOut = booking?.status === "LINK_OUT";
  const awaiting = booking?.status === "AWAITING_CONFIRMATION";
  const showFallback = aiMode && booking && (booking.links?.length ?? 0) > 0;

  return (
    <li
      id={`activity-${activity.id}`}
      tabIndex={-1}
      className={`flex flex-col gap-3 px-4 py-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lagoon-600 sm:flex-row sm:items-start sm:justify-between md:px-5 ${
        linkOut ? "bg-lagoon-50/40" : ""
      } ${awaiting ? "border-l-4 border-l-warning-700 bg-warning-50/60" : ""}`}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sand-100 text-ink-700">
          <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="font-medium text-ink-900">
            {activity.startTime && (
              <span className="mr-2 text-xs font-medium tabular-nums text-ink-500">{activity.startTime}</span>
            )}
            {activity.title}
          </p>
          {activity.description && <p className="mt-0.5 text-sm text-ink-500">{activity.description}</p>}
          {booking && !linkOut && (
            <div className="mt-1.5" aria-live="polite">
              <AiBookingDetail booking={booking} testMode={testMode} />
            </div>
          )}
        </div>
      </div>

      {booking && (
        <div className="flex flex-col gap-2 pl-11 sm:max-w-[50%] sm:shrink-0 sm:items-end sm:pl-0">
          {linkOut ? (
            <BookingLinks links={booking.links ?? []} title={activity.title} />
          ) : (
            <>
              <StatusPill status={booking.status} kind="booking" testMode={testMode} />
              {showFallback && (
                <BookingLinks links={booking.links!} title={activity.title} eyebrow="Book it yourself instead" />
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

export function ItineraryTimeline({
  days,
  aiMode,
  testMode,
}: {
  days: Day[];
  aiMode: boolean;
  testMode: boolean;
}) {
  return (
    <ol className="relative ml-5 mt-8 space-y-6 border-l-2 border-sand-300">
      {days.map((day) => (
        <li key={day.id} className="relative pl-8 md:pl-10">
          <span
            aria-hidden="true"
            className="absolute -left-[21px] top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white font-display text-lg text-ink-900 ring-2 ring-sand-300"
          >
            {day.dayIndex + 1}
          </span>
          <div className={`overflow-hidden ${CARD_CLASSES}`}>
            <div className="flex flex-wrap items-start justify-between gap-2 p-4 md:p-5">
              <div>
                <h3 className="font-display text-xl font-semibold text-ink-900">
                  Day {day.dayIndex + 1}
                  {day.date && (
                    <span className="ml-2 font-sans text-xs font-medium text-ink-500">{fmtDay(day.date)}</span>
                  )}
                </h3>
                {day.summary && <p className="mt-1 text-sm text-ink-700">{day.summary}</p>}
              </div>
              <DayChip day={day} aiMode={aiMode} />
            </div>
            <ul className="divide-y divide-sand-100 border-t border-sand-100">
              {day.activities.map((activity) => (
                <ActivityRow key={activity.id} activity={activity} aiMode={aiMode} testMode={testMode} />
              ))}
            </ul>
          </div>
        </li>
      ))}
    </ol>
  );
}
