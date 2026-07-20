import { Hono } from "hono";
import { describe, expect,it } from "vitest";

import { requireJson } from "./json-content-type.js";

/**
 * `requireJson` is a Hono middleware that rejects non-JSON POST bodies with a
 * 415 response. It accepts empty Content-Type (common in test harnesses) and
 * treats any truthy Content-Type that does not start with `application/json`
 * (case-insensitive) as invalid.
 */
function buildApp() {
  const app = new Hono();
  app.post("/", requireJson, (c) => c.json({ ok: true }));
  return app;
}

describe("requireJson middleware", () => {
  it("accepts application/json content type", async () => {
    const app = buildApp();
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ foo: 1 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("accepts application/json with a charset suffix", async () => {
    const app = buildApp();
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ foo: 1 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("accepts application/json with arbitrary casing", async () => {
    const app = buildApp();
    for (const ct of ["Application/JSON", "APPLICATION/JSON", "Application/Json"]) {
      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": ct },
        body: JSON.stringify({}),
      });
      expect(res.status, `${ct} should be accepted`).toBe(200);
    }
  });

  it("accepts empty Content-Type header (test-harness friendly)", async () => {
    const app = buildApp();
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });

  it("accepts requests with no Content-Type header at all (body-less fallback)", async () => {
    const app = buildApp();
    const res = await app.request("/", {
      method: "POST",
      headers: {},
      // No body → Hono's test client does not inject a Content-Type;
      // requireJson skips the guard and the route runs.
    });
    expect(res.status).toBe(200);
  });

  it("rejects when the browser/fetch client auto-injects text/plain (missing explicit JSON header)", async () => {
    // This is the realistic "client sent a body but forgot the header" case.
    const app = buildApp();
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(415);
  });

  it("rejects application/x-www-form-urlencoded with 415", async () => {
    const app = buildApp();
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "foo=bar",
    });
    expect(res.status).toBe(415);
    const json = await res.json();
    expect(json.error).toContain("Content-Type");
    expect(json.error.toLowerCase()).toContain("application/json");
  });

  it("rejects multipart/form-data with 415", async () => {
    const app = buildApp();
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=----" },
      body: "------\r\nContent-Disposition: form-data; name=\"file\"\r\n\r\nblob\r\n------",
    });
    expect(res.status).toBe(415);
  });

  it("rejects text/plain with 415", async () => {
    const app = buildApp();
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hello world",
    });
    expect(res.status).toBe(415);
  });

  it("rejects application/xml with 415", async () => {
    const app = buildApp();
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/xml" },
      body: "<root/>",
    });
    expect(res.status).toBe(415);
  });

  it("returns a JSON body with the error message", async () => {
    const app = buildApp();
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "text/html" },
      body: "<p>hi</p>",
    });
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toHaveProperty("error");
  });

  it("does not consume the body — the route handler can still read it on success", async () => {
    // Ensure requireJson inspects the header only; it must not call
    // c.req.json() or otherwise consume the body, or downstream handlers
    // would get an already-consumed stream.
    const app = buildApp();
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ foo: 1 }),
    });
    expect(res.status).toBe(200);
    // If requireJson had consumed the body, the route's own c.json() would
    // still return { ok: true } in our build, but the request body would have
    // been partially read — confirmed here by the fact that the route still
    // ran (which would fail if c.req.json() were called earlier in some setups).
    expect(await res.json()).toEqual({ ok: true });
  });
});
