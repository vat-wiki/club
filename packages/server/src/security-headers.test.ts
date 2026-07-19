import { describe, it, expect } from "vitest";
import { Hono } from "hono";
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
});
