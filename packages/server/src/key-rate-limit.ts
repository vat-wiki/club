// Lightweight per-key fixed-window rate limiter for the auth middleware.
//
// Purpose: once a bearer token is issued it is effectively a "password" for
// that participant. If the key is leaked (log exposure, shoulder-surfing, a
// compromised CLI cache), the attacker can replay it from any IP, so the
// global per-IP rate limiter in `rate-limit.ts` does not protect the
// credential. This limiter bounds requests **per key hash**, so a leaked key
// is rate-limited independently of the client's IP.
//
// Fixed-window semantics mirror `rate-limit.ts` for consistency; the cap is
// deliberately lower (30/min vs 120/min) because a valid key that fires 30
// requests/minute across many IPs is almost certainly compromised rather than
// legitimate multi-device usage.
//
// The in-memory store is intentional: this is a best-effort defense against
// credential abuse on a single server process. A stateless cluster deployment
// would migrate this to a shared cache (Redis) if multi-host abuse becomes a
// realistic threat.

import type { Context } from "hono";

import { hashKey } from "./crypto.js";

interface Bucket {
  windowStart: number;
  tokens: number;
}

// Module-level store; `_cleanup` evicts stale entries on a background timer.
const buckets = new Map<string, Bucket>();

const _clock = { current: Date.now };

/** Max authenticated requests per minute for a single participant key. */
export const KEY_RATE_MAX = 30;
/** Window duration in milliseconds (1 minute). */
export const KEY_RATE_WINDOW_MS = 60_000;

/** Periodic cleanup of stale buckets to prevent memory leak. */
const _cleanupRef = setInterval(_cleanup, 120_000).unref();

function _cleanup(): void {
  const now = _clock.current();
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.windowStart > KEY_RATE_WINDOW_MS) buckets.delete(key);
  }
}

/**
 * Internal clock exporter for tests so time-dependent assertions do not rely
 * on real `setTimeout` sleeps. Production code calls `Date.now` directly.
 */
export function _setNow(fn: () => number): void {
  _clock.current = fn;
}

/** Releases the background cleanup timer. Primarily for tests. */
export function _clearCleanup(): void {
  if (_cleanupRef) clearInterval(_cleanupRef);
}

/**
 * Apply a per-key fixed-window rate limit inside the auth middleware.
 *
 * Returns `null` when the key is within its budget, or a `{ error, status }`
 * object when the window has been exhausted. The caller is responsible for
 * attaching `Retry-After` if desired; this function mirrors the return style
 * of other route guards in the codebase.
 *
 * @param c - Hono request context.
 * @param key - Plaintext bearer token (already extracted from the header).
 * @returns `null` on success, or `{ error, status }` on limit breach.
 */
export function checkKeyRateLimit(c: Context, key: string): {
  error: string;
  status: number;
} | null {
  const keyHash = hashKey(key);
  const now = _clock.current();
  let bucket = buckets.get(keyHash);
  if (!bucket || now - bucket.windowStart >= KEY_RATE_WINDOW_MS) {
    bucket = { windowStart: now, tokens: KEY_RATE_MAX };
    buckets.set(keyHash, bucket);
  }

  if (bucket.tokens <= 0) {
    const remaining = Math.ceil(
      (bucket.windowStart + KEY_RATE_WINDOW_MS - now) / 1000,
    );
    c.header("Retry-After", String(remaining));
    return {
      error: `rate limit exceeded for this participant; try again in ${remaining}s`,
      status: 429,
    };
  }

  bucket.tokens--;
  return null;
}

/** Re-exported for tests only. */
export const _getNow = (): number => _clock.current();
