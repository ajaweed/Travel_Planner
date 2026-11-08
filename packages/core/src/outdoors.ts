// Fitness and access needs, and deterministic checks of hikes and nature
// outings against them -- the outdoor counterpart of dietary.ts.
//
// The itinerary agent is told to respect these needs and to describe each
// outing (difficulty, distance, climb, time). It can slip, and models are
// optimistic about "easy", so this checks two things in code:
//   1. the outing against the traveller's limits, and
//   2. the stated difficulty against the stated numbers (a 12 km walk with
//      900 m of climbing isn't "easy", whatever it's called).
// Nothing here can verify trail conditions; the UI always says to check locally.

import { z } from "zod";
import { ACCESS_LABELS, ACCESS_TAGS, DIFFICULTIES, type AccessTag, type Difficulty } from "./outdoorTags";

export { ACCESS_LABELS, ACCESS_TAGS, DIFFICULTIES, type AccessTag, type Difficulty };

export function normalizeDifficulty(raw: unknown): Difficulty | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.toLowerCase();
  if (/\b(hard|challenging|difficult|strenuous|demanding|expert)\b/.test(t)) return "hard";
  if (/\b(moderate|medium|intermediate)\b/.test(t)) return "moderate";
  if (/\b(easy|gentle|light|leisurely|flat)\b/.test(t)) return "easy";
  return undefined;
}

/** Every access need a piece of wording names: "bad knees, travelling with a toddler" -> both. */
export function normalizeAccessTags(raw: string): AccessTag[] {
  const t = raw.toLowerCase();
  const out: AccessTag[] = [];
  if (/\b(wheelchair|step[- ]free)\b/.test(t)) out.push("wheelchair");
  if (/\b(mobility|knees?|hips?|cane|walking stick|elderly|senior)\b/.test(t)) out.push("limited_mobility");
  if (/\b(kids?|children|child|toddlers?|bab(y|ies)|pram|stroller|buggy)\b/.test(t)) out.push("young_kids");
  return out;
}

const strings = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? [v] : []).filter((x): x is string => typeof x === "string");

/** Lenient field by field, like DietarySchema: one odd value never wipes the rest. */
export const OutdoorNeedsSchema = z.object({
  /** The hardest outing they want; absent = no limit stated. */
  maxDifficulty: z.unknown().transform((v) => normalizeDifficulty(v)),
  access: z.unknown().transform((v) => [...new Set(strings(v).flatMap(normalizeAccessTags))]),
  notes: z.unknown().transform((v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : undefined)),
});
export type OutdoorNeeds = z.infer<typeof OutdoorNeedsSchema>;

export const NO_OUTDOOR_NEEDS: OutdoorNeeds = { maxDifficulty: undefined, access: [], notes: undefined };

/** The stricter of two: lower max difficulty, union of access needs. */
export function mergeOutdoorNeeds(a: Partial<OutdoorNeeds> | null | undefined, b: Partial<OutdoorNeeds> | null | undefined): OutdoorNeeds {
  const levels = [a?.maxDifficulty, b?.maxDifficulty].filter((x): x is Difficulty => !!x);
  const notes = [a?.notes, b?.notes].map((n) => n?.trim()).filter((n): n is string => !!n);
  return OutdoorNeedsSchema.parse({
    maxDifficulty: levels.length ? levels.sort((x, y) => rank(x) - rank(y))[0] : undefined,
    access: [...(a?.access ?? []), ...(b?.access ?? [])],
    notes: notes.length ? [...new Set(notes)].join("; ") : undefined,
  });
}

export function outdoorNeedsFromBrief(briefJson: string | null | undefined): OutdoorNeeds | undefined {
  if (!briefJson) return undefined;
  try {
    const parsed = OutdoorNeedsSchema.safeParse(JSON.parse(briefJson)?.outdoors ?? {});
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

const DIFFICULTY_NEED_LABEL: Record<Difficulty, string | undefined> = {
  easy: "Easy walks only",
  moderate: "Moderate hikes at most",
  hard: undefined, // "anything goes" isn't a limit worth a badge
};

/** Short human labels: ["Easy walks only", "Young kids"]. */
export function outdoorNeedLabels(n: OutdoorNeeds | null | undefined): string[] {
  if (!n) return [];
  const d = n.maxDifficulty ? DIFFICULTY_NEED_LABEL[n.maxDifficulty] : undefined;
  return [...(d ? [d] : []), ...n.access.map((t) => ACCESS_LABELS[t])];
}

export function rank(d: Difficulty): number {
  return DIFFICULTIES.indexOf(d);
}

/**
 * What the numbers say, roughly (hiking-guide rules of thumb): over 15 km or
 * 800 m of climbing is hard; over 8 km or 300 m is moderate. Undefined
 * without numbers.
 */
export function impliedDifficulty(distanceKm?: number, elevationGainM?: number): Difficulty | undefined {
  if (distanceKm === undefined && elevationGainM === undefined) return undefined;
  const km = distanceKm ?? 0;
  const gain = elevationGainM ?? 0;
  if (km > 15 || gain > 800) return "hard";
  if (km > 8 || gain > 300) return "moderate";
  return "easy";
}

export type OutdoorFacts = {
  type?: string;
  difficulty?: Difficulty;
  distanceKm?: number;
  elevationGainM?: number;
};

function numbers(o: OutdoorFacts): string {
  return [
    o.distanceKm !== undefined ? `${o.distanceKm} km` : undefined,
    o.elevationGainM !== undefined ? `${o.elevationGainM} m of climbing` : undefined,
  ]
    .filter(Boolean)
    .join(" with ");
}

/**
 * Possible problems with one outing, as short sentences. Errs towards
 * flagging: a false alarm costs a glance, a miss could cost a sprained ankle.
 */
export function outdoorFlags(o: OutdoorFacts, needs: OutdoorNeeds | null | undefined): string[] {
  const flags: string[] = [];
  const implied = impliedDifficulty(o.distanceKm, o.elevationGainM);
  const effective = [o.difficulty, implied].filter((x): x is Difficulty => !!x).sort((a, b) => rank(b) - rank(a))[0];

  if (o.difficulty && implied && rank(implied) > rank(o.difficulty)) {
    flags.push(`Called ${o.difficulty}, but ${numbers(o)} is more like ${implied}.`);
  }
  if (needs?.maxDifficulty && effective && rank(effective) > rank(needs.maxDifficulty)) {
    flags.push(`This is a ${effective} outing; you asked for ${DIFFICULTY_NEED_LABEL[needs.maxDifficulty]!.toLowerCase()}.`);
  }
  const isHike = o.type === "hike" || (o.elevationGainM ?? 0) > 150 || effective === "moderate" || effective === "hard";
  const access = new Set(needs?.access ?? []);
  if (access.has("wheelchair") && (o.type === "hike" || o.type === "nature" || isHike)) {
    flags.push("Step-free access isn't confirmed for this outing.");
  } else if (access.has("limited_mobility") && isHike) {
    flags.push("Involves climbing or uneven ground; may not suit limited mobility.");
  }
  if (access.has("young_kids") && (effective === "hard" || (o.distanceKm ?? 0) > 8)) {
    flags.push("Long or hard for young kids.");
  }
  return flags;
}
