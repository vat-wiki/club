import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { bodySizeGuard,DEFAULT_MAX_BODY_BYTES } from "./body-size-guard.js";

// bodySizeGuard streams-consumes the request body (fast-pathing on a sane
// Content-Length header, slow-pathing chunked/unbounded transfers) to verify
// the body does not exceed the configured cap. Tests verify the 413 behaviour,
// the default, and the regression case the old Content-Length-only
// implementation missed: chunked-encoded oversized bodies bypassing the guard.

// bodySizeGuard is global stateless (Hono middleware with no module-level
// mutable store), so no per-test cleanup is needed.

function mkApp(limiter: ReturnType<typeof bodySizeGuard>): Hono {
  const app = new Hono();
  // Use a route that actually parses the body so the limit fires during
  // the read, exactly as it does for JSON endpoints.
  app.use("/test", limiter, async (c) => {
    const json = await c.req.json();
    return c.json({ ok: true, payload: json });
  });
  return app;
}

describe("body-size-guard", () => {
  const SMALL_MAX = 100;

  it("allows payloads under the limit", async () => {
    const limiter = bodySizeGuard(SMALL_MAX);
    const app = mkApp(limiter);
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects oversized payloads with 413", async () => {
    const limiter = bodySizeGuard(SMALL_MAX);
    const app = mkApp(limiter);
    const big = JSON.stringify({ x: "A".repeat(200) }); // > 100 bytes
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: big,
    });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("uses DEFAULT_MAX_BODY_BYTES as the default", async () => {
    expect(DEFAULT_MAX_BODY_BYTES).toBe(5 * 1024 * 1024);
    // Smoke-test that calling the factory with no args returns a callable
    // middleware with no error.
    const limiter = bodySizeGuard();
    expect(typeof limiter).toBe("function");
  });

  it("rejects oversized bodies sent as a ReadableStream (regression: old guard only checked Content-Length, so chunked requests bypassed it)", async () => {
    // Supply the body as a ReadableStream so the request has no Content-Length
    // header (Hono sends it chunked). The old implementation would allow this
    // through; bodyLimit measures actual bytes consumed and rejects it.
    const limiter = bodySizeGuard(SMALL_MAX);
    const app = mkApp(limiter);

    const encoder = new TextEncoder();
    const big = JSON.stringify({ x: "A".repeat(200) });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(big));
        controller.close();
      },
    });

    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stream,
      duplex: "half",
    });
    expect(res.status).toBe(413);
  });
});
