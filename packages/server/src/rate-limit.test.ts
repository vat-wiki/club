import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { rateLimit } from "./rate-limit.js";

// Each test creates its own Hono instance so route registration is isolated.
// The rate-limit middleware uses module-level state (`buckets`), so tests use
// unique prefixes in their key extractors to avoid collisions across tests.

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
  });

  it("resets the bucket when the window expires", async () => {
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

  it("falls back to x-forwarded-for, then x-real-ip, then 'unknown'", async () => {
    const limiter = rateLimit({ max: 1, windowMs: 60_000 });
    const app = mkApp(limiter);

    const res1 = await app.request("/test", { headers: { "x-forwarded-for": "10.0.0.1" } });
    expect(res1.status).toBe(200);

    const res2 = await app.request("/test", { headers: { "x-forwarded-for": "10.0.0.1" } });
    expect(res2.status).toBe(429);

    // Different IP — new bucket
    const res3 = await app.request("/test", { headers: { "x-forwarded-for": "10.0.0.2" } });
    expect(res3.status).toBe(200);
  });
});
