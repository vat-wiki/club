// Shared retry/backoff utilities for HTTP transport and SSE reconnection.
// Pure functions, safe to import anywhere (browser + Node).

/**
 * @module retry
 * Shared, platform-agnostic retry and backoff helpers used by
 * {@link transport.ts|HTTP transport} and {@link ../../sdk/src/stream.ts|SSE reconnection}.
 * All functions are pure or synchronous-construct, making them easy to test
 * in isolation and safe to use in both browser and Node environments.
 */

/**
 * Decide whether an HTTP response should be retried.
 *
 * Only idempotent GET requests are ever retried: POST /messages or
 * POST /rooms would duplicate the write on retry. Within the allowed
 * methods, only rate-limit (429) and server errors (>= 500) are retried.
 * Client errors such as 401 or 404 are propagated immediately because
 * retrying them cannot succeed without caller input.
 *
 * @param method - HTTP method string (e.g. `"GET"`, `"POST"`).
 * @param status - HTTP status code returned by the server.
 * @returns `true` if the response should be retried.
 * @example
 * ```ts
 * if (shouldRetry("GET", 503)) { /* retry *\/ }
 * ```
 */
export function shouldRetry(method: string, status: number): boolean {
  // Only idempotent reads are retried; POST /messages is never retried
  // (a retry could duplicate the message).
  if (method !== 'GET') return false;
  return status === 429 || status >= 500;
}

/**
 * Deterministic exponential backoff in milliseconds.
 *
 * Returns `min(base * 2^attempt, cap)`. Use this for tests or any
 * path where reproducibility matters; callers who want real-world
 * jitter should prefer {@link jitteredBackoff} instead.
 *
 * @param attempt - 0-based retry attempt index.
 * @param base - Starting backoff in milliseconds (default `200`).
 * @param cap - Maximum backoff in milliseconds (default `2000`).
 * @returns Backoff in milliseconds.
 * @example
 * ```ts
 * computeBackoff(0) // 200
 * computeBackoff(1) // 400
 * computeBackoff(3, 100, 500) // 500 (capped)
 * ```
 */
export function computeBackoff(attempt: number, base = 200, cap = 2000): number {
  return Math.min(cap, base * 2 ** attempt);
}

/**
 * Full-jitter backoff: a random value in 50-100% of the exponential
 * curve, capped at `cap`.
 *
 * Full jitter (AWS's recommended pattern) reduces thundering-herd
 * effects during widespread outages: each caller draws a different
 * backoff, so reconnect traffic is smoothed rather than bunched.
 *
 * @param attempt - 0-based retry attempt index.
 * @param base - Starting backoff in milliseconds (default `200`).
 * @param cap - Maximum backoff in milliseconds (default `2000`).
 * @returns Randomised backoff in milliseconds.
 */
export function jitteredBackoff(attempt: number, base = 200, cap = 2000): number {
  return computeBackoff(attempt, base, cap) * (0.5 + Math.random() * 0.5);
}

/**
 * Await `ms` milliseconds, or return immediately if the supplied signal
 * is already aborted (or aborts during the wait).
 *
 * Used by transport-level retry loops so an aborted fetch can cancel
 * the pending backoff rather than waiting for the full delay.
 *
 * @param ms - Milliseconds to sleep.
 * @param signal - Optional `AbortSignal` to cancel the sleep early.
 * @returns Promise that resolves when `ms` elapses or the signal aborts.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true }
    );
  });
}
