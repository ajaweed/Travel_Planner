// Hike and nature details on itinerary stops, plus the standing caveat.
// Honesty rules (docs/visual-design.md §4.11): trail details are the AI's
// until our checks say otherwise; flags from our checks are always shown;
// a trail not found on OpenStreetMap is NOT a warning (most walks aren't
// waymarked routes).

import {
  Accessibility,
  AlertTriangle,
  CalendarDays,
  Clock,
  ExternalLink,
  Info,
  Mountain,
  Route,
  ShieldAlert,
  Ticket,
  TrendingUp,
  Trees,
  Waves,
  type LucideIcon,
} from "lucide-react";
// Type-only import: erased at build, so no server code reaches the client.
import type { OutdoorView } from "@trip-planner/core";
import { RestaurantCheckLine } from "./Food";

export type Outdoor = OutdoorView;

const DIFFICULTY_STYLES: Record<string, string> = {
  easy: "bg-success-50 text-success-700",
  moderate: "bg-warning-50 text-warning-700",
  hard: "bg-danger-50 text-danger-700",
};

export function outdoorIcon(type: string | undefined): LucideIcon {
  if (type === "hike") return Mountain;
  if (type === "beach" || type === "water") return Waves;
  return Trees;
}

function Note({ Icon, label, text, tone = "text-ink-700" }: { Icon: LucideIcon; label: string; text?: string; tone?: string }) {
  if (!text) return null;
  return (
    <p className={`flex items-start gap-1.5 text-xs ${tone}`}>
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0" />
      <span>
        <span className="font-medium">{label}:</span> {text}
      </span>
    </p>
  );
}

/** Difficulty, distance, climb, time, then notes, checks and flags. */
export function OutdoorDetail({ outdoor }: { outdoor: Outdoor }) {
  const facts = [
    outdoor.distanceKm !== undefined && { Icon: Route, text: `${outdoor.distanceKm} km` },
    outdoor.elevationGainM !== undefined && { Icon: TrendingUp, text: `${outdoor.elevationGainM} m climb` },
    outdoor.durationHours !== undefined && { Icon: Clock, text: `${outdoor.durationHours} h` },
  ].filter((f): f is { Icon: LucideIcon; text: string } => !!f);
  const trail = outdoor.trailCheck?.status === "FOUND" ? outdoor.trailCheck : undefined;

  return (
    <div className="mt-1.5 space-y-1 text-sm">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-700">
        {outdoor.difficulty && (
          <span className={`rounded-full px-2 py-0.5 font-semibold capitalize ${DIFFICULTY_STYLES[outdoor.difficulty] ?? ""}`}>
            {outdoor.difficulty}
          </span>
        )}
        {facts.map(({ Icon, text }) => (
          <span key={text} className="inline-flex items-center gap-1 tabular-nums">
            <Icon size={13} strokeWidth={1.75} aria-hidden="true" />
            {text}
          </span>
        ))}
        {outdoor.placeName && <span className="font-medium text-ink-900">{outdoor.placeName}</span>}
        {outdoor.links.map((l) => (
          <a
            key={l.url}
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${l.provider} for ${outdoor.placeName ?? outdoor.trailName ?? "this outing"} (opens in a new tab)`}
            className="inline-flex items-center gap-1 rounded font-medium text-lagoon-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lagoon-600"
          >
            {l.provider}
            <ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />
          </a>
        ))}
      </p>
      <RestaurantCheckLine check={outdoor.placeCheck} />
      {trail && (
        <p className="flex items-start gap-1.5 text-xs text-success-700">
          <Route size={14} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0" />
          <span>
            <span className="font-medium">Trail on OpenStreetMap:</span> {trail.name}
            {trail.lengthKm ? ` · ${trail.lengthKm} km mapped` : ""}
          </span>
        </p>
      )}
      <Note Icon={Info} label="Trail length" text={outdoor.trailNote} tone="text-warning-700" />
      <Note Icon={Ticket} label="Permit" text={outdoor.permit} />
      <Note Icon={CalendarDays} label="Season" text={outdoor.seasonalNote} />
      <Note Icon={ShieldAlert} label="Safety" text={outdoor.safetyNote} />
      <Note Icon={Accessibility} label="Access" text={outdoor.accessNote} tone="text-lagoon-700" />
      {outdoor.flags.length > 0 && (
        <div className="text-xs font-medium text-warning-700">
          {outdoor.flags.map((f) => (
            <p key={f} className="flex items-start gap-1.5">
              <AlertTriangle size={14} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0" />
              {f}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** The standing caveat wherever hikes or nature outings are suggested. */
export function OutdoorCaveat() {
  return (
    <p className="flex items-start gap-2 text-xs text-ink-500">
      <Info size={14} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0" />
      Trail details are AI-suggested: check conditions, closures and permits locally before you set out, and turn back if in
      doubt.
    </p>
  );
}
