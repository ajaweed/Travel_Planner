import type { BookingMode } from "@trip-planner/db";
import type { AiBookingReadiness } from "@trip-planner/core";

export type { BookingMode };

// Who books the plan the user is about to choose. SELF is the default: the AI
// spending someone's money must always be an explicit opt-in.
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
  const choices: Array<{ mode: BookingMode; title: string; body: string }> = [
    {
      mode: "SELF",
      title: "I’ll book it myself",
      body: "You get a link for every flight, hotel and tour. Nothing is booked or charged by us.",
    },
    {
      mode: "AI",
      title: "Let the AI book it for me",
      body: "An AI agent books each item for you, checking every price against your budget first. Anything it can’t book comes back to you with links.",
    },
  ];

  return (
    <fieldset className="mt-8" disabled={disabled}>
      <legend className="text-sm font-semibold text-neutral-300">How do you want to book?</legend>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {choices.map((c) => {
          const selected = value === c.mode;
          const unavailable = c.mode === "AI" && readiness !== undefined && !readiness.anyConfigured;
          return (
            <label
              key={c.mode}
              className={`cursor-pointer rounded-xl border p-4 transition-colors ${
                selected ? "border-neutral-200 bg-neutral-800" : "border-neutral-700 hover:border-neutral-500"
              } ${disabled || unavailable ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="booking-mode"
                  value={c.mode}
                  checked={selected}
                  disabled={unavailable}
                  onChange={() => onChange(c.mode)}
                  className="accent-white"
                />
                <span className="text-sm font-medium text-neutral-100">{c.title}</span>
              </div>
              <p className="mt-1 pl-6 text-sm text-neutral-400">{c.body}</p>
              {c.mode === "AI" && readiness && aiCaveat(readiness) && (
                <p className="mt-2 pl-6 text-xs text-amber-300">{aiCaveat(readiness)}</p>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

// Every non-"fully live" state gets a caveat, and partial production is called
// out explicitly: "nothing real will be charged" would be false there.
function aiCaveat(r: AiBookingReadiness): string | null {
  if (!r.anyConfigured) {
    return "Not available yet: no booking providers are connected. Add provider keys to turn on AI booking.";
  }
  if (r.live) return null;
  if (r.anyLive) {
    return "Some booking providers are live: the AI may make real bookings and charges for some items. Others are in test mode and fall back to links.";
  }
  return "Booking providers are in test mode, so nothing real will be booked or charged yet. Anything the AI can’t book falls back to links.";
}
