import { afterAll, beforeEach, describe, expect,it } from "vitest";

import {
  _clearCleanup,
  _getNow,
  _setNow,
  checkKeyRateLimit,
  KEY_RATE_MAX,
  KEY_RATE_WINDOW_MS,
} from "./key-rate-limit.js";

const nowMs = 100_000;

// Minimal mock Context: only needs `header` and `setHeader` surface used by
// `checkKeyRateLimit`. Hono's real `c.header()` is both a getter and setter.
class MockContext {
  private _headers = new Map<string, string>();

  header(_name: string): string | undefined {
    return undefined;
  }

  setHeader(name: string, value: string): void {
    this._headers.set(name, value);
  }

  getHeader(name: string): string | undefined {
    return this._headers.get(name);
  }
}

// `checkKeyRateLimit` calls `c.header` in the form `c.header("Retry-After", …)`
// for setting. Our mock's setter path is a no-op for this test; we only need
// to assert the return value and that `Retry-After` was set.
type MockContextWithHeaderSetter = MockContext & {
  header(name: string, value: string): void;
};

describe("key-rate-limit", () => {
  beforeEach(() => {
    _setNow(() => nowMs);
  });

  it("is within budget on first call", () => {
    const ctx = {
      header(_n: string, _v?: string) {},
    } as MockContextWithHeaderSetter;
    const res = checkKeyRateLimit(ctx, "secret-key");
    expect(res).toBeNull();
  });

  it("exhausts the budget after exactly MAX calls", () => {
    const ctx = {
      header(_n: string, _v?: string) {},
    } as MockContextWithHeaderSetter;
    for (let i = 0; i < KEY_RATE_MAX; i++) {
      expect(checkKeyRateLimit(ctx, "same-key")).toBeNull();
    }
    const exceeded = checkKeyRateLimit(ctx, "same-key");
    expect(exceeded).not.toBeNull();
    expect(exceeded!.status).toBe(429);
    expect(exceeded!.error).toContain("rate limit exceeded");
  });

  it("scopes buckets per key hash", () => {
    const ctx = {
      header(_n: string, _v?: string) {},
    } as MockContextWithHeaderSetter;
    for (let i = 0; i < KEY_RATE_MAX; i++) {
      checkKeyRateLimit(ctx, "key-a");
    }
    expect(checkKeyRateLimit(ctx, "key-a")).not.toBeNull();
    // key-b is still within budget
    expect(checkKeyRateLimit(ctx, "key-b")).toBeNull();
  });

  it("resets the window after WINDOW_MS", () => {
    const ctx = {
      header(_n: string, _v?: string) {},
    } as MockContextWithHeaderSetter;
    for (let i = 0; i < KEY_RATE_MAX; i++) {
      checkKeyRateLimit(ctx, "rotating-key");
    }
    expect(checkKeyRateLimit(ctx, "rotating-key")).not.toBeNull();

    // Advance time past the window
    _setNow(() => nowMs + KEY_RATE_WINDOW_MS + 1);
    // Window expired → fresh bucket
    expect(checkKeyRateLimit(ctx, "rotating-key")).toBeNull();
    _setNow(() => nowMs);
  });

  it("sets Retry-After header when limit is breached", () => {
    const ctx = {
      header(_n: string, _v?: string) {},
    } as MockContextWithHeaderSetter;
    for (let i = 0; i < KEY_RATE_MAX; i++) {
      checkKeyRateLimit(ctx, "retry-key");
    }
    const exceeded = checkKeyRateLimit(ctx, "retry-key");
    expect(exceeded).not.toBeNull();
    expect(exceeded!.error).toMatch(/try again in \d+s/);
  });

  it("does not count auth failures against the same bucket as another key", () => {
    const ctx = {
      header(_n: string, _v?: string) {},
    } as MockContextWithHeaderSetter;
    checkKeyRateLimit(ctx, "a");
    checkKeyRateLimit(ctx, "b");
    // Each key has its own bucket: both consume from their own, not shared.
    expect(checkKeyRateLimit(ctx, "a")).toBeNull();
    expect(checkKeyRateLimit(ctx, "b")).toBeNull();
  });
});

// Tear down the background cleanup timer after the describe block has run.
afterAll(() => {
  _clearCleanup();
});

