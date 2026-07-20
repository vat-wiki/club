import { Hono } from "hono";
import { describe, expect,it } from "vitest";

import { securityHeaders } from "./security-headers.js";

describe("securityHeaders", () => {
  it("adds Content-Security-Policy header", async () => {
    const app = new Hono();
    app.use("*", securityHeaders);
    app.get("/", (c) => c.json({ ok: true }));
    const res = await app.request("/");
    expect(res.headers.get("content-security-policy")).toMatch(/default-src 'self'/);
  });

  it("adds Strict-Transport-Security header", async () => {
    const app = new Hono();
    app.use("*", securityHeaders);
    app.get("/", (c) => c.json({ ok: true }));
    const res = await app.request("/");
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
  });

  it("adds X-Content-Type-Options header", async () => {
    const app = new Hono();
    app.use("*", securityHeaders);
    app.get("/", (c) => c.json({ ok: true }));
    const res = await app.request("/");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("adds X-Frame-Options header", async () => {
    const app = new Hono();
    app.use("*", securityHeaders);
    app.get("/", (c) => c.json({ ok: true }));
    const res = await app.request("/");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("adds Referrer-Policy header", async () => {
    const app = new Hono();
    app.use("*", securityHeaders);
    app.get("/", (c) => c.json({ ok: true }));
    const res = await app.request("/");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("adds Permissions-Policy header", async () => {
    const app = new Hono();
    app.use("*", securityHeaders);
    app.get("/", (c) => c.json({ ok: true }));
    const res = await app.request("/");
    expect(res.headers.get("permissions-policy")).toMatch(/camera=\(\)/);
  });

  it("passes through the response body from the route handler", async () => {
    const app = new Hono();
    app.use("*", securityHeaders);
    app.get("/ping", (c) => c.json({ ping: "pong" }));
    const res = await app.request("/ping");
    expect(await res.json()).toEqual({ ping: "pong" });
  });

  it("adds a unique X-Request-ID on each request", async () => {
    const app = new Hono();
    app.use("*", securityHeaders);
    app.get("/", (c) => c.json({ ok: true }));
    const res1 = await app.request("/");
    const res2 = await app.request("/");
    const id1 = res1.headers.get("x-request-id");
    const id2 = res2.headers.get("x-request-id");
    expect(id1).toMatch(/^[0-9a-f-]{36}$/);
    expect(id2).toMatch(/^[0-9a-f-]{36}$/);
    expect(id1).not.toBe(id2);
  });

  it("disables DNS prefetch", async () => {
    const app = new Hono();
    app.use("*", securityHeaders);
    app.get("/", (c) => c.json({ ok: true }));
    const res = await app.request("/");
    expect(res.headers.get("x-dns-prefetch-control")).toBe("off");
  });

  it("sets no-store Cache-Control on every response", async () => {
    const app = new Hono();
    app.use("*", securityHeaders);
    app.get("/", (c) => c.json({ ok: true }));
    const res = await app.request("/");
    const cc = res.headers.get("cache-control");
    expect(cc).toContain("no-store");
    expect(cc).toContain("no-cache");
    expect(cc).toContain("must-revalidate");
    expect(cc).toContain("max-age=0");
  });

  it("sets Pragma: no-cache for legacy caches", async () => {
    const app = new Hono();
    app.use("*", securityHeaders);
    app.get("/", (c) => c.json({ ok: true }));
    const res = await app.request("/");
    expect(res.headers.get("pragma")).toBe("no-cache");
  });

  it("varies cache key on Authorization header", async () => {
    const app = new Hono();
    app.use("*", securityHeaders);
    app.get("/", (c) => c.json({ ok: true }));
    const res = await app.request("/");
    const vary = res.headers.get("vary");
    expect(vary).toBe("Authorization");
  });

  it("allows route handlers to override Cache-Control for cacheable content", async () => {
    const app = new Hono();
    app.use("*", securityHeaders);
    app.get("/asset", (c) => {
      c.header("Cache-Control", "public, immutable, max-age=31536000");
      return c.text("cached");
    });
    const res = await app.request("/asset");
    expect(res.headers.get("cache-control")).toBe("public, immutable, max-age=31536000");
  });

  it("sets cross-origin isolation headers (CORP / COEP / COOP)", async () => {
    const app = new Hono();
    app.use("*", securityHeaders);
    app.get("/", (c) => c.json({ ok: true }));
    const res = await app.request("/");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(res.headers.get("cross-origin-embedder-policy")).toBe("require-corp");
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin-origin-when-cross-origin");
  });

  it("sets X-Permitted-Cross-Domain-Policies to none (Flash/SWF hardening)", async () => {
    const app = new Hono();
    app.use("*", securityHeaders);
    app.get("/", (c) => c.json({ ok: true }));
    const res = await app.request("/");
    expect(res.headers.get("x-permitted-cross-domain-policies")).toBe("none");
  });

  it("sets X-Download-Options to noopen (prevent inline execution of downloaded files)", async () => {
    const app = new Hono();
    app.use("*", securityHeaders);
    app.get("/", (c) => c.json({ ok: true }));
    const res = await app.request("/");
    expect(res.headers.get("x-download-options")).toBe("noopen");
  });

  it("sets X-Robots-Tag to prevent search-engine indexing", async () => {
    const app = new Hono();
    app.use("*", securityHeaders);
    app.get("/", (c) => c.json({ ok: true }));
    const res = await app.request("/");
    const tag = res.headers.get("x-robots-tag");
    expect(tag).toContain("noindex");
    expect(tag).toContain("nofollow");
    expect(tag).toContain("noarchive");
  });

  it("Permissions-Policy includes usb and serial sensors", async () => {
    const app = new Hono();
    app.use("*", securityHeaders);
    app.get("/", (c) => c.json({ ok: true }));
    const res = await app.request("/");
    const pp = res.headers.get("permissions-policy") ?? "";
    expect(pp).toMatch(/usb=\(\)/);
    expect(pp).toMatch(/serial=\(\)/);
    expect(pp).toMatch(/magnetometer=\(\)/);
  });
});
