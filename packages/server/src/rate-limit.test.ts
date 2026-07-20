import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import { rateLimit, getClientIp, _getNow, _setNow, _clearCleanup } from "./rate-limit.js";

// Each test creates its own Hono instance so route registration is isolated.
// The rate-limit middleware uses module-level state (`buckets`), so tests use
// unique prefixes in their key extractors to avoid collisions across tests.

// Reset the internal clock and stale buckets after every test so no real-time
// timer state leaks between cases.
let _savedNow: (() => number) | undefined;
function resetLimiterState() {
  _setNow(Date.now as () => number);
  _savedNow = undefined;
}
function stubNow(at: number): () => number {
  _savedNow = _getNow;
  _setNow(() => at);
  return () => at;
}
afterEach(() => {
  // Clear the module's internal store so leftover buckets don't affect later tests.
  resetLimiterState();
  _clearCleanup();
});

function mkApp(limiter: ReturnType<typeof rateLimit>): Hono {
  const app = new Hono();
  app.use("/test", limiter, (c) => c.json({ ok: true }));
  return app;
}

describe("rateLimit", () => {
  it("allows requests under the limit", async () => {
    const prefix = `rl-allow-${Math.random().toString(36).slice(2)}`;
    const limiter = rateLimit({ max: 5, windowMs: 60_000, key: () => prefix });
    const app = mkApp(limiter);
    const res = await app.request("/test");
    expect(res.status).toBe(200);
    // Standard rate-limit headers are present.
    expect(res.headers.get("X-RateLimit-Limit")).toBe("5");
    expect(Number(res.headers.get("X-RateLimit-Remaining"))).toBe(4);
  });

  it("rejects requests that exceed the limit with 429", async () => {
    const prefix = `rl-over-${Math.random().toString(36).slice(2)}`;
    const limiter = rateLimit({ max: 2, windowMs: 60_000, key: () => prefix });
    const app = mkApp(limiter);
    await app.request("/test");
    await app.request("/test");
    const res = await app.request("/test");
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toHaveProperty("error", "rate limited");
    expect(res.headers.get("Retry-After")).toMatch(/^\d+$/);
    // Rate-limited responses don't set the per-request limit/remaining headers
    // because tokens aren't decremented on a rejected call.
  });

  it("uses a fixed window: expires at window boundary, not mid-window", async () => {
    // Pin time so no `setTimeout` wait is needed.
    stubNow(0);
    const prefix = `rl-fixed-${Math.random().toString(36).slice(2)}`;
    const limiter = rateLimit({ max: 1, windowMs: 100, key: () => prefix });
    const app = mkApp(limiter);

    // First request at t=0 consumes the single token.
    await app.request("/test");

    // At t=99 (within the same window) the bucket is still empty.
    stubNow(99);
    const mid = await app.request("/test");
    expect(mid.status).toBe(429);

    // At t=100 the window has expired — fresh bucket, token restored.
    stubNow(100);
    const after = await app.request("/test");
    expect(after.status).toBe(200);
    resetLimiterState();
  });

  it("resets the bucket when the window expires (real-time wait)", async () => {
    const prefix = `rl-expire-${Math.random().toString(36).slice(2)}`;
    const limiter = rateLimit({ max: 1, windowMs: 5, key: () => prefix });
    const app = mkApp(limiter);
    await app.request("/test");
    await new Promise((r) => setTimeout(r, 20));
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  it("uses a custom key extractor", async () => {
    const limiter = rateLimit({
      max: 1,
      windowMs: 60_000,
      key: (c) => c.req.header("x-user-id") ?? "anon",
    });
    const app = mkApp(limiter);

    const res1 = await app.request("/test", { headers: { "x-user-id": "user-a" } });
    expect(res1.status).toBe(200);

    // Same user — should be limited
    const res2 = await app.request("/test", { headers: { "x-user-id": "user-a" } });
    expect(res2.status).toBe(429);

    // Different user — new bucket, allowed
    const res3 = await app.request("/test", { headers: { "x-user-id": "user-b" } });
    expect(res3.status).toBe(200);
  });

  it("falls back to x-forwarded-for, then x-real-ip, then 'unknown' (trustedProxy=true)", async () => {
    const limiter = rateLimit({
      max: 1,
      windowMs: 60_000,
      key: (c) =>
       getClientIp(
          c,
          () => ({ remote: { address: "127.0.0.1" } }),
          true, // behind a trusted reverse proxy
        ),
    });
    const app = mkApp(limiter);

    const res1 = await app.request("/test", { headers: { "x-forwarded-for": "10.0.0.1" } });
    expect(res1.status).toBe(200);

    const res2 = await app.request("/test", { headers: { "x-forwarded-for": "10.0.0.1" } });
    expect(res2.status).toBe(429);

    // Different IP — new bucket, allowed
    const res3 = await app.request("/test", { headers: { "x-forwarded-for": "10.0.0.2" } });
    expect(res3.status).toBe(200);

    // Proxy headers ignored; different x-real-ip still buckets by the same
    // source — only the first two were from 10.0.0.1.
    const res4 = await app.request("/test", { headers: { "x-real-ip": "192.168.1.1" } });
    expect(res4.status).toBe(200);
  });

  it("falls back to socket address via getConnInfo when headers absent", async () => {
    const limiter = rateLimit({
      max: 1,
      windowMs: 60_000,
      key: (c) => getClientIp(c, () => ({ remote: { address: "127.0.0.1" } })),
    });
    const app = mkApp(limiter);

    const res1 = await app.request("/test");
    expect(res1.status).toBe(200);

    // Same socket IP — should be limited
    const res2 = await app.request("/test");
    expect(res2.status).toBe(429);
  });

type MockContext = {
  req: {
    header: (h: string) => string | undefined;
    raw: { headers: { get: (h: string) => string | null } };
  };
};

  it("getClientIp ignores proxy headers by default (trustedProxy=false)", () => {
    const c: MockContext = {
      req: {
        header: (h: string) => (h === "x-forwarded-for" ? "203.0.113.5, 10.0.0.2" : undefined),
        raw: { headers: { get: (h: string) => (h === "x-real-ip" ? "198.51.100.7" : null) } },
      },
    };
    // Both proxy headers are present, but without trustedProxy=true they are
    // ignored. The socket address is the sole source of truth.
    expect(getClientIp(c)).toBe("unknown");
    expect(getClientIp(c, () => ({ remote: { address: "10.0.0.3" } }))).toBe("10.0.0.3");
  });

  it("getClientIp falls back to 'unknown' when nothing available", () => {
    const c: MockContext = {
      req: { header: () => undefined, raw: { headers: { get: () => null } } },
    };
    expect(getClientIp(c)).toBe("unknown");
    expect(getClientIp(c, () => undefined)).toBe("unknown");
  });

  it("getClientIp ignores spoofed proxy headers when trustedProxy=false", () => {
    // This is the regression case the opt-in proxy behaviour was introduced to
    // block: an attacker reaches the server directly and sends a forged
    // X-Forwarded-For header to bypass the per-IP rate limit.
    const c: MockContext = {
      req: {
        header: () => "1.2.3.4, attacker-injection",
        raw: { headers: { get: () => null } },
      },
    };
    expect(getClientIp(c)).toBe("unknown");
    expect(getClientIp(c, () => ({ remote: { address: "2001:db8::1" } }))).toBe("2001:db8::1");
  });

  // ── Trusted-proxy mode (behind a reverse proxy) ────────────────────

  it("getClientIp picks leftmost x-forwarded-for when trustedProxy=true", () => {
    const c: MockContext = {
      req: {
        header: (h: string) => (h === "x-forwarded-for" ? "203.0.113.5, 10.0.0.2" : undefined),
        raw: { headers: { get: () => null } },
      },
    };
    expect(getClientIp(c, undefined, true)).toBe("203.0.113.5");
  });

  it("getClientIp falls back to x-real-ip when trustedProxy=true", () => {
    const c: MockContext = {
      req: {
        header: () => undefined,
        raw: { headers: { get: (h: string) => (h === "x-real-ip" ? "198.51.100.7" : null) } },
      },
    };
    expect(getClientIp(c, undefined, true)).toBe("198.51.100.7");
  });

  it("getClientIp falls back to socket address from getConnInfo", () => {
    const c: MockContext = {
      req: { header: () => undefined, raw: { headers: { get: () => null } } },
    };
    expect(getClientIp(c, () => ({ remote: { address: "10.0.0.3" } }))).toBe("10.0.0.3");
  });

  it("getClientIp accepts an IPv6 address from socket", () => {
    const c: MockContext = {
      req: { header: () => undefined, raw: { headers: { get: () => null } } },
    };
    expect(getClientIp(c, () => ({ remote: { address: "2001:db8::1" } }))).toBe("2001:db8::1");
  });

  it("getClientIp accepts an IPv6 address from proxy header when trustedProxy=true", () => {
    const c: MockContext = {
      req: {
        header: () => undefined,
        raw: { headers: { get: (h: string) => (h === "x-real-ip" ? "::1" : null) } },
      },
    };
    expect(getClientIp(c, undefined, true)).toBe("::1");
  });

  it("getClientIp rejects malformed x-forwarded-for and falls through", () => {
    const c: MockContext = {
      req: {
        header: () => "invalid, 1.2.3.4",
        raw: { headers: { get: () => null } },
      },
    };
    // Invalid leftmost → skip; no socket → fallback to "unknown".
    expect(getClientIp(c, undefined, true)).toBe("unknown");
  });

  it("getClientIp rejects empty and garbage proxy headers", () => {
    const c: MockContext = {
      req: {
        header: (h: string) => (h === "x-forwarded-for" ? "" : undefined),
        raw: { headers: { get: (h: string) => (h === "x-real-ip" ? "not-an-ip" : null) } },
      },
    };
    expect(getClientIp(c, undefined, true)).toBe("unknown");
  });
});
