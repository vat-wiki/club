import { afterEach,beforeEach, describe, expect, it, vi } from "vitest";

import { computeBackoff, jitteredBackoff, shouldRetry, sleep } from "./retry.js";

// ── shouldRetry ───────────────────────────────────────────────────────

describe("shouldRetry", () => {
  it("never retries non-GET methods (POST could duplicate side effects)", () => {
    expect(shouldRetry("POST", 500)).toBe(false);
    expect(shouldRetry("PUT", 503)).toBe(false);
    expect(shouldRetry("PATCH", 429)).toBe(false);
    expect(shouldRetry("DELETE", 502)).toBe(false);
  });

  it("retries GET 429 (rate-limited)", () => {
    expect(shouldRetry("GET", 429)).toBe(true);
  });

  it("retries GET 5xx server errors", () => {
    expect(shouldRetry("GET", 500)).toBe(true);
    expect(shouldRetry("GET", 502)).toBe(true);
    expect(shouldRetry("GET", 503)).toBe(true);
    expect(shouldRetry("GET", 504)).toBe(true);
  });

  it("does not retry GET 4xx client errors (except 429)", () => {
    expect(shouldRetry("GET", 400)).toBe(false);
    expect(shouldRetry("GET", 401)).toBe(false);
    expect(shouldRetry("GET", 403)).toBe(false);
    expect(shouldRetry("GET", 404)).toBe(false);
  });

  it("does not retry GET 2xx or 3xx responses", () => {
    expect(shouldRetry("GET", 200)).toBe(false);
    expect(shouldRetry("GET", 204)).toBe(false);
    expect(shouldRetry("GET", 301)).toBe(false);
    expect(shouldRetry("GET", 304)).toBe(false);
  });
});

// ── computeBackoff ────────────────────────────────────────────────────

describe("computeBackoff", () => {
  it("grows exponentially with attempt", () => {
    expect(computeBackoff(0)).toBe(200);
    expect(computeBackoff(1)).toBe(400);
    expect(computeBackoff(2)).toBe(800);
    expect(computeBackoff(3)).toBe(1600);
  });

  it("caps at the provided limit (default 2000)", () => {
    expect(computeBackoff(4)).toBe(2000);
    expect(computeBackoff(10)).toBe(2000);
    expect(computeBackoff(20)).toBe(2000);
  });

  it("uses custom base and cap when provided", () => {
    expect(computeBackoff(0, 100, 1000)).toBe(100);
    expect(computeBackoff(1, 100, 1000)).toBe(200);
    expect(computeBackoff(2, 100, 1000)).toBe(400);
    expect(computeBackoff(3, 100, 1000)).toBe(800);
    expect(computeBackoff(4, 100, 1000)).toBe(1000); // capped
  });

  it("starts at the base value for attempt 0", () => {
    expect(computeBackoff(0, 500)).toBe(500);
    expect(computeBackoff(0, 1000)).toBe(1000);
  });
});

// ── jitteredBackoff ───────────────────────────────────────────────────

describe("jitteredBackoff", () => {
  it("produces a value between 50% and 100% of the exponential backoff", () => {
    // With attempt=0, base=200 → exponential = 200. Jitter = 200 * (0.5..1.0).
    // Run multiple times; at least one should fall strictly inside (50, 100)%.
    let foundInside = false;
    for (let i = 0; i < 100; i++) {
      const j = jitteredBackoff(0, 200, 2000);
      expect(j).toBeGreaterThanOrEqual(100);
      expect(j).toBeLessThanOrEqual(200);
      if (j > 100 && j < 200) foundInside = true;
    }
    expect(foundInside).toBe(true);
  });

  it("respects the cap", () => {
    // Exponential at attempt=10 with base=200, cap=2000 → 2000.
    // Jitter range = [1000, 2000].
    for (let i = 0; i < 20; i++) {
      const j = jitteredBackoff(10, 200, 2000);
      expect(j).toBeGreaterThanOrEqual(1000);
      expect(j).toBeLessThanOrEqual(2000);
    }
  });
});

// ── sleep ─────────────────────────────────────────────────────────────

describe("sleep", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves after the given milliseconds", async () => {
    const p = sleep(100);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();
  });

  it("resolves immediately when the signal is already aborted", async () => {
    const signal = AbortSignal.abort();
    const p = sleep(99999, signal);
    // No need to advance timers — should resolve synchronously.
    await expect(p).resolves.toBeUndefined();
  });

  it("resolves immediately when aborted before the sleep finishes", async () => {
    const ac = new AbortController();
    const p = sleep(5000, ac.signal);
    // Abort before timers fire.
    ac.abort();
    await expect(p).resolves.toBeUndefined();

    // Even advancing timers should not break anything.
    await vi.runAllTimersAsync();
  });

  it("does not resolve until timer fires when not aborted", async () => {
    const signal = new AbortController().signal;
    const p = sleep(10, signal);

    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();
  });
});
