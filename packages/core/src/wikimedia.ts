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
  waiters: Array<() => void>; // parked acquire() calls; each removes itself when woken
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

// Every request gets its own timeout, and nobody waits long for a slot: these
// lookups run inside users' page requests, and a photo is never worth a hang.
export const REQUEST_TIMEOUT_MS = 8_000;
export const MAX_QUEUE_WAIT_MS = 5_000;

/**
 * Waits for a slot (fewer than MAX_IN_FLIGHT running, budget left this
 * minute). Throws WikimediaUnavailable instead of waiting past
 * MAX_QUEUE_WAIT_MS, while blocked by a 429, or once `signal` aborts.
 */
async function acquire(signal?: AbortSignal): Promise<void> {
  const s = state();
  const deadline = Date.now() + MAX_QUEUE_WAIT_MS;
  // Giving up after being woken for a free slot: hand the wakeup on.
  const fail = (why: string) => {
    if (s.inFlight < MAX_IN_FLIGHT) s.waiters[0]?.();
    return new WikimediaUnavailable(why);
  };
  for (;;) {
    const now = Date.now();
    if (now < s.blockedUntil) throw fail("rate limited by Wikimedia");
    if (signal?.aborted) throw fail("aborted");
    s.sent = s.sent.filter((t) => now - t < 60_000);
    const budgetWait = s.sent.length >= REQUESTS_PER_MINUTE ? 60_000 - (now - s.sent[0]!) + 5 : 0;
    if (s.inFlight < MAX_IN_FLIGHT && budgetWait === 0) {
      s.sent.push(now);
      s.inFlight++;
      return;
    }
    const wait = Math.min(budgetWait || Infinity, deadline - now);
    if (wait <= 0 || now + budgetWait > deadline) throw fail("busy: request budget used up");
    // Park until a slot frees (release), the budget window moves, the
    // deadline passes or the caller aborts -- whichever comes first. Every
    // exit removes us from the queue, so no wakeup is ever lost on a waiter
    // that has already given up.
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        const i = s.waiters.indexOf(done);
        if (i >= 0) s.waiters.splice(i, 1);
        resolve();
      };
      const timer = setTimeout(done, wait);
      signal?.addEventListener("abort", done);
      s.waiters.push(done);
    });
  }
}

function release(): void {
  const s = state();
  s.inFlight--;
  s.waiters[0]?.();
}

/** Wakes every waiter, e.g. after a 429, so they fail fast instead of parking. */
function wakeAll(): void {
  for (const w of [...state().waiters]) w();
}

function withTimeout(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  if (!signal) return timeout;
  const ctrl = new AbortController();
  for (const sig of [signal, timeout]) {
    if (sig.aborted) ctrl.abort();
    else sig.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  return ctrl.signal;
}

/**
 * GET api.php with the given query params (format/formatversion added).
 * Throws WikimediaUnavailable when rate-limited, busy, timed out, aborted or
 * failing; callers treat that as "no photo right now" and must not cache it
 * as a real miss.
 */
export async function wikiQuery(api: string, params: Record<string, string>, signal?: AbortSignal): Promise<any> {
  const s = state();
  const fetchFn = s.fetchFn ?? (fetch as unknown as FetchLike);
  const qs = new URLSearchParams({ action: "query", format: "json", formatversion: "2", ...params });
  await acquire(signal);
  try {
    const res = await fetchFn(`${api}?${qs}`, {
      headers: { "User-Agent": userAgent(), "Api-User-Agent": userAgent() },
      signal: withTimeout(signal),
      // Next's server fetch cache would otherwise keep answers forever.
      cache: "no-store",
    });
    if (res.status === 429 || res.status === 503) {
      const retryAfter = Number(res.headers?.get("retry-after"));
      s.backoffMs = Math.min(Math.max(s.backoffMs * 2, 5_000), 10 * 60_000);
      s.blockedUntil = Date.now() + (retryAfter > 0 ? retryAfter * 1000 : s.backoffMs);
      wakeAll();
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
