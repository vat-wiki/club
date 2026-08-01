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

// A passthrough handler that does NOT parse the body, used to assert the
// guard called next() (200) instead of 413-ing a multipart upload. The files
// route enforces its own per-kind cap on the parsed File, so the guard must
// let the multipart body through untouched.
function mkUploadApp(limiter: ReturnType<typeof bodySizeGuard>): Hono {
  const app = new Hono();
  app.use("/upload", limiter, async (c) => {
    return c.json({ ok: true });
  });
  return app;
}

// Build a minimal multipart/form-data body carrying a single "file" field
// with the given payload bytes.
function multipartBody(boundary: string, payload: string): string {
  return [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="video.mp4"`,
    `Content-Type: video/mp4`,
    ``,
    payload,
    `--${boundary}--`,
    ``,
  ].join("\r\n");
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

  // ── multipart/form-data exemption ───────────────────────────────────
  //
  // The files route enforces a per-kind cap (video 50MB / document 25MB /
  // image 10MB) on the parsed File, far above this guard's 5MB default.
  // Without an exemption, the guard's fast-path (Content-Length) and
  // slow-path (stream-consume) both 413 a legitimate large upload before it
  // reaches the files handler. These tests pin the exemption so the
  // regression cannot silently return.

  it("exempts multipart/form-data above the limit (fast-path Content-Length bypassed)", async () => {
    const limiter = bodySizeGuard(SMALL_MAX);
    const app = mkUploadApp(limiter);
    // Body is well over the 100-byte cap, so Hono auto-sets a Content-Length
    // > SMALL_MAX. Pre-fix, the fast-path would 413 here; post-fix the
    // multipart exemption fires first.
    const body = multipartBody("----testboundary", "X".repeat(500));
    const res = await app.request("/upload", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=----testboundary" },
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("exempts multipart/form-data sent as a ReadableStream (slow-path bypassed)", async () => {
    const limiter = bodySizeGuard(SMALL_MAX);
    const app = mkUploadApp(limiter);
    // Streamed body -> no Content-Length (chunked). Pre-fix the slow-path
    // would stream-consume past SMALL_MAX and 413; post-fix the exemption
    // passes it through unread.
    const body = multipartBody("----testboundary", "X".repeat(500));
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });
    const res = await app.request("/upload", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=----testboundary" },
      body: stream,
      duplex: "half",
    });
    expect(res.status).toBe(200);
  });

  it("exempts multipart/form-data regardless of Content-Type casing", async () => {
    const limiter = bodySizeGuard(SMALL_MAX);
    const app = mkUploadApp(limiter);
    const body = multipartBody("----testboundary", "X".repeat(500));
    const res = await app.request("/upload", {
      method: "POST",
      headers: { "Content-Type": "MULTIPART/FORM-DATA; boundary=----testboundary" },
      body,
    });
    expect(res.status).toBe(200);
  });

  it("exempts a >5MB multipart upload at the default cap (the reported B2 regression)", async () => {
    // Default guard is 5MB. A >5MB multipart body would be 413'd by the
    // fast-path without the exemption. Use a 6MB payload so the test mirrors
    // the real-world video upload scenario (50MB allowed per-kind cap).
    const limiter = bodySizeGuard();
    const app = mkUploadApp(limiter);
    const body = multipartBody("----testboundary", "X".repeat(6 * 1024 * 1024));
    const res = await app.request("/upload", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=----testboundary" },
      body,
    });
    expect(res.status).toBe(200);
  });

  it("still 413s an oversized application/json body (guard remains active for JSON)", async () => {
    // Regression guard: the exemption is multipart-only. A JSON body over the
    // limit must still be rejected.
    const limiter = bodySizeGuard(SMALL_MAX);
    const app = mkApp(limiter);
    const big = JSON.stringify({ x: "A".repeat(200) }); // > 100 bytes
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: big,
    });
    expect(res.status).toBe(413);
  });
});
