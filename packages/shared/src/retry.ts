// Shared retry/backoff utilities for HTTP transport and SSE reconnection.
// Pure functions, safe to import anywhere (browser + Node).

/** Whether a response of this status on this method is worth retrying. */
export function shouldRetry(method: string, status: number): boolean {
  // Only idempotent reads are retried; POST /messages is never retried
  // (a retry could duplicate the message).
  if (method !== "GET") return false;
  return status === 429 || status >= 500;
}

/** Deterministic exponential backoff (ms) for a 0-based attempt. */
export function computeBackoff(attempt: number, base = 200, cap = 2000): number {
  return Math.min(cap, base * 2 ** attempt);
}

/** Full-jitter backoff: 50-100% of exponential value, capped at 2s. */
export function jitteredBackoff(attempt: number, base = 200, cap = 2000): number {
  return computeBackoff(attempt, base, cap) * (0.5 + Math.random() * 0.5);
}

/** Sleep helper that resolves immediately if the signal is already aborted. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}
