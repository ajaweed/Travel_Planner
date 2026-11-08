import { Bot, ExternalLink, FlaskConical, ShieldCheck, type LucideIcon } from "lucide-react";
import type { BookingMode } from "@trip-planner/db";
import type { AiBookingReadiness } from "@trip-planner/core";

export type { BookingMode };

// Who books the plan the user is about to choose (docs/visual-design.md §4.3
// "Booking mode"). SELF is the default: the AI spending someone's money must
// always be an explicit opt-in. Native radios inside a fieldset, visually
// hidden, so arrow keys and screen readers work for free.
export function BookingModePicker({
  value,
  onChange,
  readiness,
  disabled,
}: {
  value: BookingMode;
  onChange: (mode: BookingMode) => void;
  readiness: AiBookingReadiness | undefined;
  disabled: boolean;
}) {
  const choices: Array<{ mode: BookingMode; title: string; body: string; Icon: LucideIcon }> = [
    {
      mode: "SELF",
      title: "I’ll book it myself",
      body: "You get a ready-made search link for every flight, hotel and tour. We don’t book or charge anything.",
      Icon: ExternalLink,
    },
    {
      mode: "AI",
      title: "Let the AI book it for me",
      body: "Our booking agent books each item through provider APIs, checking every price against your budget first. Anything it can’t book comes back to you with links.",
      Icon: Bot,
    },
  ];

  return (
    <fieldset
      disabled={disabled}
      className={`mt-6 motion-safe:transition-opacity ${disabled ? "opacity-60 saturate-50" : ""}`}
    >
      <legend className="text-base font-semibold text-ink-900">How do you want to book?</legend>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {choices.map((c) => {
          const selected = value === c.mode;
          const unavailable = c.mode === "AI" && readiness !== undefined && !readiness.anyConfigured;
          return (
            <label
              key={c.mode}
              className={`relative flex gap-3 rounded-2xl border bg-white p-4 motion-safe:transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-lagoon-600 has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-sand-50 ${
                selected ? "border-lagoon-600 bg-lagoon-50/50 ring-2 ring-lagoon-600" : "border-sand-200"
              } ${
                unavailable || disabled ? "cursor-not-allowed" : "cursor-pointer hover:border-lagoon-600"
              } ${unavailable ? "opacity-60" : ""}`}
            >
              <input
                type="radio"
                name="bookingMode"
                value={c.mode}
                checked={selected}
                disabled={unavailable}
                onChange={() => onChange(c.mode)}
                className="sr-only"
              />
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-lagoon-50 text-lagoon-700">
                <c.Icon size={18} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 pr-6">
                <span className="block font-semibold text-ink-900">{c.title}</span>
                <span className="mt-1 block text-sm text-ink-700">{c.body}</span>
                {c.mode === "AI" && readiness && <AiCaveat readiness={readiness} />}
              </span>
              {/* Drawn radio dot */}
              <span
                aria-hidden="true"
                className={`absolute right-4 top-4 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 ${
                  selected ? "border-lagoon-600" : "border-sand-400"
                }`}
              >
                {selected && <span className="h-2 w-2 rounded-full bg-lagoon-600" />}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

// Visible whether or not the AI card is selected: people should see it before
// they pick. Partial production is called out explicitly, because "nothing
// real will be charged" would be false there.
function AiCaveat({ readiness: r }: { readiness: AiBookingReadiness }) {
  if (!r.anyConfigured) {
    return (
      <span className="mt-3 block text-sm text-ink-700">
        AI booking isn’t available yet: no booking providers are connected. You can still book
        everything yourself.
      </span>
    );
  }
  if (r.live) {
    return (
      <span className="mt-3 flex items-start gap-1.5 text-xs text-ink-500">
        <ShieldCheck size={14} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0" />
        Real bookings, charged by each provider. You’ll see a confirmation reference for each one.
      </span>
    );
  }
  return (
    <span className="mt-3 flex gap-2 rounded-xl bg-warning-50 p-3 text-sm text-ink-900">
      <FlaskConical size={16} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-warning-700" />
      <span>
        {r.anyLive ? (
          <>
            <strong>Partly live.</strong> Some providers are live, so the AI may make real bookings and
            charges for some items. The rest are in test mode and fall back to links.
          </>
        ) : (
          <>
            <strong>Test mode.</strong> Booking providers are in test mode, so nothing real will be booked
            or charged. Anything the AI can’t book falls back to links.
          </>
        )}
      </span>
    </span>
  );
}
