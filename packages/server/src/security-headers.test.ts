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
});
