// Date grounding for the planning agents.
//
// The model has no clock: asked for "4 days in March" with no year, it picks
// a year from its training data, which produced itineraries dated in the past
// (observed: March 2025 trips planned in November 2026). Two layers fix that:
//   1. Agents are told today's date in their prompts (todayISO).
//   2. A deterministic guard (rollBriefForward) never lets a past start date
//      out of the concierge, so nothing downstream -- itinerary dates, flight
//      and hotel search hints -- can be built on one, whatever the model did.

/** Today's date as YYYY-MM-DD in the server's local timezone. */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseISO(s: string): Date | null {
  const m = ISO_DATE.exec(s);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // Reject rollovers like 2026-02-30.
  return date.getUTCMonth() === Number(m[2]) - 1 ? date : null;
}

function formatISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addYears(d: Date, years: number): Date {
  const out = new Date(d);
  out.setUTCFullYear(out.getUTCFullYear() + years);
  // Feb 29 -> Mar 1 in a non-leap year would shift the trip; clamp to Feb 28.
  if (out.getUTCMonth() !== d.getUTCMonth()) out.setUTCDate(0);
  return out;
}

type DatedBrief = { startDate?: string; endDate?: string };

/**
 * If the brief's startDate is before `today`, move it (and endDate, keeping
 * the trip length) forward by whole years until it isn't. Whole years keep
 * the month the traveller asked for ("in March" stays March, next one).
 * Briefs with no/unparseable dates are returned unchanged.
 */
export function rollBriefForward<T extends DatedBrief>(brief: T, today: string = todayISO()): T {
  if (!brief.startDate) return brief;
  const start = parseISO(brief.startDate);
  const now = parseISO(today);
  if (!start || !now || start >= now) return brief;

  let years = now.getUTCFullYear() - start.getUTCFullYear();
  if (addYears(start, years) < now) years += 1;

  const out: T = { ...brief, startDate: formatISO(addYears(start, years)) };
  const end = brief.endDate ? parseISO(brief.endDate) : null;
  if (end) {
    const lengthMs = end.getTime() - start.getTime();
    out.endDate = formatISO(new Date(parseISO(out.startDate!)!.getTime() + lengthMs));
  }
  return out;
}
