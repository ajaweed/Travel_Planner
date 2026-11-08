// Waymarked hiking routes from OpenStreetMap, via Waymarked Trails
// (https://hiking.waymarkedtrails.org, a free community service; data
// (c) OpenStreetMap contributors, ODbL). Read-only.
//
// Used to check a named trail the itinerary agent proposes: does a mapped
// route by that name exist near the trip, and how long is it really?
// Deciding whether a result IS the named trail is the caller's job
// (packages/core/src/trailChecks.ts) -- search is fuzzy ("Sintra" also
// returns "Sint Jacobsroute").
//
// Be a good citizen: callers cap, cache and serialise these calls; every
// request identifies the app and has a timeout.

import type { ProviderResult } from "./types";

const API = "https://hiking.waymarkedtrails.org/api/v1";
const TIMEOUT_MS = 8_000;
// Contact for the service's operators, as for Wikimedia (product owner chose the repo URL).
const USER_AGENT = `TripPlannerAI/0.1 (${process.env.WIKIMEDIA_CONTACT?.trim() || "https://github.com/ajaweed/Travel_Planner"})`;

export type TrailSummary = { id: number; name: string; ref?: string; group?: string };

export type TrailDetails = {
  id: number;
  name: string;
  ref?: string;
  /** Mapped length of the route, metres (OpenStreetMap geometry; else the official length). */
  lengthM?: number;
  /** Centre of the route's bounding box. */
  centre?: { lat: number; lon: number };
  operator?: string;
  /** The route's page on Waymarked Trails. */
  url: string;
};

async function get(path: string): Promise<ProviderResult<any>> {
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return { ok: false, reason: "NO_AVAILABILITY" };
    if (res.status === 429) return { ok: false, reason: "RATE_LIMITED", retryAfterMs: 5_000 };
    if (!res.ok) return { ok: false, reason: "PROVIDER_ERROR", message: `Waymarked Trails ${res.status}`, retryable: res.status >= 500 };
    return { ok: true, data: await res.json() };
  } catch (err) {
    return { ok: false, reason: "PROVIDER_ERROR", message: err instanceof Error ? err.message : String(err), retryable: true };
  }
}

/** Routes whose name or ref matches the query (fuzzy), best first. */
export async function searchTrails(query: string, limit = 5): Promise<ProviderResult<TrailSummary[]>> {
  if (!query.trim()) return { ok: false, reason: "NO_AVAILABILITY" };
  const res = await get(`/list/search?query=${encodeURIComponent(query.trim())}&limit=${limit}`);
  if (!res.ok) return res;
  const results: unknown = res.data?.results;
  const list = (Array.isArray(results) ? results : []).flatMap((r: any): TrailSummary[] =>
    r?.type === "relation" && Number.isInteger(r.id) && typeof r.name === "string"
      ? [{ id: r.id, name: r.name, ref: typeof r.ref === "string" ? r.ref : undefined, group: r.group }]
      : [],
  );
  return list.length ? { ok: true, data: list } : { ok: false, reason: "NO_AVAILABILITY" };
}

/** Spherical web-mercator (EPSG:3857) metres -> lat/lon degrees. */
export function mercatorToLatLon(x: number, y: number): { lat: number; lon: number } {
  const R = 6378137;
  return {
    lon: (x / R) * (180 / Math.PI),
    lat: (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI),
  };
}

export async function trailDetails(id: number): Promise<ProviderResult<TrailDetails>> {
  const res = await get(`/details/relation/${id}`);
  if (!res.ok) return res;
  const d = res.data ?? {};
  const length = Number(d.route?.length) || Number(d.official_length) || undefined;
  const bbox: unknown = d.bbox;
  let centre: TrailDetails["centre"];
  if (Array.isArray(bbox) && bbox.length === 4 && bbox.every((n) => Number.isFinite(n))) {
    const [x1, y1, x2, y2] = bbox as number[];
    centre = mercatorToLatLon((x1! + x2!) / 2, (y1! + y2!) / 2);
  }
  return {
    ok: true,
    data: {
      id,
      name: typeof d.name === "string" ? d.name : String(id),
      ref: typeof d.ref === "string" ? d.ref : undefined,
      lengthM: length && length > 0 ? length : undefined,
      centre,
      operator: typeof d.operator === "string" ? d.operator : undefined,
      url: `https://hiking.waymarkedtrails.org/#route?id=${id}&type=relation`,
    },
  };
}
