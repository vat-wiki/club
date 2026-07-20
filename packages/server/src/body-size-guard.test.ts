import { Hono, Context } from "hono";
import { bodySizeGuard, DEFAULT_MAX_BODY_BYTES } from "../body-size-guard.js";

describe("body-size-guard", () => {
  function buildApp(maxBytes?: number) {
    const app = new Hono();
    app.use("*", bodySizeGuard(maxBytes));
    app.post("/", (c) => c.json({ ok: true }));
    return app;
  }

  it("accepts requests under the limit", async () => {
    const app = buildApp(1024);
    const res = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Length": "2" },
      body: "{}",
    });
    expect(res.status).toBe(200);
  });

  it("rejects requests over the limit with 413", async () => {
    const app = buildApp(1024);
    const res = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Length": "2048" },
      body: "x".repeat(2048),
    });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toContain("exceeds 1024 bytes limit");
    // Content-Length on the response body should be small (the error JSON),
    // never the oversized value the attacker advertised.
    expect(Number(res.headers.get("content-length") ?? 0)).toBeLessThan(1024);
  });

  it("passes through when Content-Length is absent", async () => {
    const _app = buildApp(1);
    // No Content-Length header at all.
    const ctx = new Context(new Request("http://localhost/"), {});
    expect(ctx.req.header("content-length")).toBeNull();
  });

  it("uses the configured default size constant", () => {
    expect(DEFAULT_MAX_BODY_BYTES).toBe(5 * 1024 * 1024);
  });

  it("treats non-finite Content-Length as oversized", async () => {
    const app = buildApp(1024);
    const res = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Length": "NaN" },
      body: "{}",
    });
    expect(res.status).toBe(413);
  });

  it("treats negative Content-Length as oversized", async () => {
    const app = buildApp(1024);
    const res = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Length": "-1" },
      body: "{}",
    });
    expect(res.status).toBe(413);
  });
});
