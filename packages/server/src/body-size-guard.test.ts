import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { bodySizeGuard,DEFAULT_MAX_BODY_BYTES,MULTIPART_MAX_BODY_BYTES } from "./body-size-guard.js";

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
// let a multipart body under the 60MB cap through untouched.
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

  // ── multipart/form-data higher cap ──────────────────────────────────
  //
  // The files route enforces a per-kind cap (video 50MB / document 25MB /
  // image 10MB) on the parsed File, far above this guard's 5MB default.
  // Multipart bodies are therefore held to a higher 60MB cap
  // (MULTIPART_MAX_BODY_BYTES) instead of the 5MB default, so legitimate
  // uploads pass while an OOM DoS (unbounded multipart body buffered by
  // parseBody before the per-kind check) is still blocked. These tests pin
  // both the pass-through (under 60MB) and the rejection (over 60MB).

  it("allows multipart/form-data above the 5MB default but under the 60MB cap (fast-path Content-Length)", async () => {
    const limiter = bodySizeGuard(SMALL_MAX);
    const app = mkUploadApp(limiter);
    // Body is well over the 100-byte non-multipart cap, so Hono auto-sets a
    // Content-Length > SMALL_MAX. The multipart 60MB cap applies instead of
    // the 100-byte default, so the fast-path passes it through.
    const body = multipartBody("----testboundary", "X".repeat(500));
    const res = await app.request("/upload", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=----testboundary" },
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("allows multipart/form-data sent as a ReadableStream (slow-path under 60MB cap)", async () => {
    const limiter = bodySizeGuard(SMALL_MAX);
    const app = mkUploadApp(limiter);
    // Streamed body -> no Content-Length (chunked). The slow-path
    // stream-consumes but the 60MB multipart cap (not the 100-byte default)
    // applies, so 500 bytes passes through.
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

  it("allows multipart/form-data regardless of Content-Type casing", async () => {
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

  it("allows a >5MB multipart upload at the default cap (the reported B2 regression)", async () => {
    // Default guard is 5MB for non-multipart. A >5MB multipart body would be
    // 413'd by the fast-path if the 5MB limit applied. The 60MB multipart cap
    // lets it through, mirroring the real-world video upload scenario (50MB
    // allowed per-kind cap).
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
    // Regression guard: the higher cap is multipart-only. A JSON body over the
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

  it("rejects a multipart body exceeding MULTIPART_MAX_BODY_BYTES (60MB cap, slow-path)", async () => {
    // A multipart body larger than 60MB must be rejected with 413. Uses a
    // pull-based ReadableStream so chunks are allocated on demand (not all
    // upfront); the guard reads one chunk at a time and 413s as soon as the
    // cumulative size exceeds the cap, so peak memory stays bounded.
    const limiter = bodySizeGuard();
    const app = mkUploadApp(limiter);
    const overSize = MULTIPART_MAX_BODY_BYTES + 1; // 60MB + 1 byte
    const stream = new ReadableStream({
      start(controller) {
        // Single chunk just over the cap: the guard reads it, detects
        // size > effectiveMax, and returns 413 without buffering it.
        controller.enqueue(new Uint8Array(overSize));
        controller.close();
      },
    });
    const res = await app.request("/upload", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=----testboundary" },
      body: stream,
      duplex: "half",
    });
    expect(res.status).toBe(413);
  });
});
