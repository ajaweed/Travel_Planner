// The one way this app talks to the Wikimedia Action API (Wikipedia,
// Wikivoyage). Everything goes through `wikiQuery` so the whole process
// shares one budget:
//
// - Identified User-Agent with contact info. Without it Wikimedia allows 10
//   requests/minute; with it, 200 (https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits).
// - At most 3 requests in flight (their guidance) and a rolling-minute budget
//   comfortably under 200.
// - 429/503 honour Retry-After (else exponential back-off); while blocked,
//   calls fail fast instead of queueing.
//
// State lives on globalThis: Next bundles each route separately, and a
// per-bundle limiter would multiply the real request rate.

export const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
export const WIKIVOYAGE_API = "https://en.wikivoyage.org/w/api.php";

// Contact for Wikimedia's operators (User-Agent policy). Product owner chose
// the public repo URL (2026-11-08); override with WIKIMEDIA_CONTACT.
const DEFAULT_CONTACT = "https://github.com/ajaweed/Travel_Planner";
const MAX_IN_FLIGHT = 3;
export const REQUESTS_PER_MINUTE = 120;

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal; cache?: "no-store" },
) => Promise<{ ok: boolean; status: number; headers?: { get(name: string): string | null }; json(): Promise<any> }>;

export class WikimediaUnavailable extends Error {}

type LimiterState = {
  inFlight: number;
  waiters: Array<() => void>;
  sent: number[]; // timestamps of requests in the last minute
  blockedUntil: number;
  backoffMs: number;
  fetchFn: FetchLike | null;
};

const g = globalThis as unknown as { __tripPlannerWikimedia?: LimiterState };
function state(): LimiterState {
  return (g.__tripPlannerWikimedia ??= {
    inFlight: 0,
    waiters: [],
    sent: [],
    blockedUntil: 0,
    backoffMs: 0,
    fetchFn: null,
  });
}

/** Test hook: swap the fetch implementation and reset the limiter. */
export function setWikimediaFetch(fn: FetchLike | null): void {
  g.__tripPlannerWikimedia = undefined;
  state().fetchFn = fn;
}

export function userAgent(): string {
  const contact = process.env.WIKIMEDIA_CONTACT?.trim() || DEFAULT_CONTACT;
  return `TripPlannerAI/0.1 (${contact}) bot`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new WikimediaUnavailable("aborted"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new WikimediaUnavailable("aborted"));
    });
  });
}

async function acquire(signal?: AbortSignal): Promise<void> {
  const s = state();
  for (;;) {
    if (Date.now() < s.blockedUntil) throw new WikimediaUnavailable("rate limited by Wikimedia");
    if (signal?.aborted) throw new WikimediaUnavailable("aborted");
    if (s.inFlight >= MAX_IN_FLIGHT) {
      await new Promise<void>((resolve) => s.waiters.push(resolve));
      continue;
    }
    const now = Date.now();
    s.sent = s.sent.filter((t) => now - t < 60_000);
    if (s.sent.length >= REQUESTS_PER_MINUTE) {
      // Wait for the oldest request to leave the window.
      await sleep(60_000 - (now - s.sent[0]!) + 5, signal);
      continue;
    }
    s.sent.push(now);
    s.inFlight++;
    return;
  }
}

function release(): void {
  const s = state();
  s.inFlight--;
  s.waiters.shift()?.();
}

/**
 * GET api.php with the given query params (format/formatversion added).
 * Throws WikimediaUnavailable when rate-limited, aborted or failing; callers
 * treat that as "no photo right now" and must not cache it as a real miss.
 */
export async function wikiQuery(api: string, params: Record<string, string>, signal?: AbortSignal): Promise<any> {
  const s = state();
  const fetchFn = s.fetchFn ?? (fetch as unknown as FetchLike);
  const qs = new URLSearchParams({ action: "query", format: "json", formatversion: "2", ...params });
  await acquire(signal);
  try {
    const res = await fetchFn(`${api}?${qs}`, {
      headers: { "User-Agent": userAgent(), "Api-User-Agent": userAgent() },
      signal,
      // Next's server fetch cache would otherwise keep answers forever.
      cache: "no-store",
    });
    if (res.status === 429 || res.status === 503) {
      const retryAfter = Number(res.headers?.get("retry-after"));
      s.backoffMs = Math.min(Math.max(s.backoffMs * 2, 5_000), 10 * 60_000);
      s.blockedUntil = Date.now() + (retryAfter > 0 ? retryAfter * 1000 : s.backoffMs);
      throw new WikimediaUnavailable(`Wikimedia returned ${res.status}`);
    }
    if (!res.ok) throw new WikimediaUnavailable(`Wikimedia returned ${res.status}`);
    s.backoffMs = 0;
    return await res.json();
  } catch (err) {
    throw err instanceof WikimediaUnavailable ? err : new WikimediaUnavailable(String(err));
  } finally {
    release();
  }
}
