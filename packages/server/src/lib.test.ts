import type { Context } from "hono";
import { Hono } from "hono";
import { describe, expect,it } from "vitest";
import { z } from "zod";

import {
  isValidRoomSlug,
  jsonErr,
  parseBearer,
  parseJsonBody,
  parseLimit,
  requireValidRoomSlug,
  withOptionalMiddleware,
} from "./lib.js";

function buildApp(handler: (c: Context) => Response) {
  const app = new Hono();
  app.get("/", handler);
  return app;
}

describe("parseLimit", () => {
  it("returns the fallback for missing/undefined input", () => {
    expect(parseLimit(undefined)).toBe(100);
    expect(parseLimit(undefined, 50)).toBe(50);
  });

  it("returns the fallback for non-numeric strings", () => {
    expect(parseLimit("abc")).toBe(100);
    expect(parseLimit("")).toBe(100);
  });

  it("returns the fallback for non-finite numbers", () => {
    expect(parseLimit("Infinity")).toBe(100);
    expect(parseLimit(Infinity)).toBe(100);
    expect(parseLimit(NaN)).toBe(100);
  });

  it("treats 0 as invalid (returns fallback, never 0)", () => {
    expect(parseLimit("0")).toBe(100);
    expect(parseLimit(0)).toBe(100);
  });

  it("treats negatives as invalid — never passes an unbounded limit through", () => {
    expect(parseLimit("-1")).toBe(100);
    expect(parseLimit(-5)).toBe(100);
  });

  it("clamps values above 500 down to 500", () => {
    expect(parseLimit("501")).toBe(500);
    expect(parseLimit(99999)).toBe(500);
  });

  it("keeps valid in-range integers unchanged", () => {
    expect(parseLimit("1")).toBe(1);
    expect(parseLimit("50")).toBe(50);
    expect(parseLimit("500")).toBe(500);
    expect(parseLimit(250)).toBe(250);
  });

  it("floors fractional values within range", () => {
    expect(parseLimit("10.9")).toBe(10);
    expect(parseLimit(2.5)).toBe(2);
  });
});

describe("parseBearer", () => {
  it("extracts the token from a well-formed Bearer header", () => {
    expect(parseBearer("Bearer club_human_abc")).toBe("club_human_abc");
  });

  it("is case-insensitive on the scheme word", () => {
    expect(parseBearer("bearer club_x")).toBe("club_x");
    expect(parseBearer("BEARER club_x")).toBe("club_x");
  });

  it("tolerates extra whitespace and trims the token", () => {
    expect(parseBearer("Bearer   club_x")).toBe("club_x");
    expect(parseBearer("Bearer club_x   ")).toBe("club_x");
  });

  it("returns undefined when the header is missing or empty", () => {
    expect(parseBearer(undefined)).toBeUndefined();
    expect(parseBearer("")).toBeUndefined();
  });

  it("returns undefined for 'Bearer' with no token", () => {
    expect(parseBearer("Bearer")).toBeUndefined();
    expect(parseBearer("Bearer ")).toBeUndefined();
  });

  it("returns undefined for non-Bearer schemes", () => {
    expect(parseBearer("Basic dXNlcjpwYXNz")).toBeUndefined();
    expect(parseBearer("Token club_x")).toBeUndefined();
  });
});

describe("jsonErr", () => {
  it("returns a { error: message } JSON body with the given status", async () => {
    const app = buildApp((c) => jsonErr(c, "not found", 404));
    const res = await app.request("/");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("defaults to status 400 when no status is provided", async () => {
    const app = buildApp((c) => jsonErr(c, "bad request"));
    const res = await app.request("/");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad request" });
  });

  it("sets Content-Type to application/json", async () => {
    const app = buildApp((c) => jsonErr(c, "oops"));
    const res = await app.request("/");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("preserves the message string exactly, including special chars", async () => {
    const app = buildApp((c) =>
      jsonErr(c, "invalid: foo\nbar 'baz' <>&", 422),
    );
    const res = await app.request("/");
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("invalid: foo\nbar 'baz' <>&");
  });

  it("returns a non-empty response even for an empty message string", async () => {
    const app = buildApp((c) => jsonErr(c, ""));
    const res = await app.request("/");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "" });
  });

  it("allows any contentful status code", async () => {
    for (const status of [200, 201, 301, 403, 500] as const) {
      const app = buildApp((c) => jsonErr(c, "msg", status));
      const res = await app.request("/");
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error: "msg" });
    }
  });
});

// ── Room slug validation ─────────────────────────────────────────────

/**
 * Pure predicate, no Hono context — exercise the full shape of the contract
 * (`ROOM_SLUG_REGEX`) at every edge so the guard that protects SSE room fan-out
 * from CRLF injection never regresses.
 */
describe("isValidRoomSlug (pure predicate)", () => {
  it("accepts a single alphanumeric character", () => {
    expect(isValidRoomSlug("a")).toBe(true);
    expect(isValidRoomSlug("9")).toBe(true);
  });

  it("accepts lowercase letters, digits, and hyphens in any order", () => {
    expect(isValidRoomSlug("general")).toBe(true);
    expect(isValidRoomSlug("dev-tools")).toBe(true);
    expect(isValidRoomSlug("room-1")).toBe(true);
    expect(isValidRoomSlug("9abc")).toBe(true);
  });

  it("accepts slugs up to the 30-character maximum", () => {
    const maxLen = "0123456789abcdef0123456789abcd"; // 30 chars
    expect(maxLen.length).toBe(30);
    expect(isValidRoomSlug(maxLen)).toBe(true);
  });

  it("rejects a slug that is one character over the 30-character maximum", () => {
    const overMax = "0123456789abcdef0123456789abcde"; // 31 chars
    expect(overMax.length).toBe(31);
    expect(isValidRoomSlug(overMax)).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidRoomSlug("")).toBe(false);
  });

  it("rejects a slug starting with a hyphen or underscore", () => {
    expect(isValidRoomSlug("-bad")).toBe(false);
    expect(isValidRoomSlug("--bad")).toBe(false);
    expect(isValidRoomSlug("_private")).toBe(false);
  });

  it("rejects a slug that does not start with an alphanumeric character", () => {
    expect(isValidRoomSlug("1")).toBe(true); // digit is valid
    expect(isValidRoomSlug("-")).toBe(false);
  });

  it("rejects uppercase letters (room slugs must be lowercase)", () => {
    expect(isValidRoomSlug("General")).toBe(false);
    expect(isValidRoomSlug("GEN")).toBe(false);
    expect(isValidRoomSlug("gEn")).toBe(false);
  });

  it("rejects control characters and whitespace that can poison SSE fan-out", () => {
    expect(isValidRoomSlug("room\n")).toBe(false);
    expect(isValidRoomSlug("a\r\nb")).toBe(false);
    expect(isValidRoomSlug("ok\tevent:hack")).toBe(false);
    expect(isValidRoomSlug("ok\nevent:hack")).toBe(false);
    expect(isValidRoomSlug(" room")).toBe(false); // leading space
    expect(isValidRoomSlug("room ")).toBe(false); // trailing space
  });

  it("rejects path separators and traversal tokens", () => {
    expect(isValidRoomSlug("room/slash")).toBe(false);
    expect(isValidRoomSlug("room\\back")).toBe(false);
    expect(isValidRoomSlug("../etc")).toBe(false);
    expect(isValidRoomSlug("room..name")).toBe(false);
  });

  it("rejects special characters not in the allowed set", () => {
    expect(isValidRoomSlug("room@domain")).toBe(false);
    expect(isValidRoomSlug("room:name")).toBe(false);
    expect(isValidRoomSlug("room?query")).toBe(false);
    expect(isValidRoomSlug("room#frag")).toBe(false);
  });

  it("is deterministic for a large set of inputs (no random/DB side-effect)", () => {
    const inputs = ["general", "general", "a", "ok"];
    for (const s of inputs) {
      const a = isValidRoomSlug(s);
      const b = isValidRoomSlug(s);
      expect(a).toBe(b);
    }
  });
});

/**
 * `requireValidRoomSlug` is a Hono-Context wrapper around `isValidRoomSlug`.
 * Contract: it MUST produce the exact same boolean verdict as `isValidRoomSlug`,
 * or the two helpers can diverge and a caller that checks one but calls the other
 * (or vice versa) can silently allow a malicious slug through.
 *
 * We cannot assert the boolean verdict from the wrapper's return type alone
 * (valid slug → undefined, invalid → `{ ok: false, r: Response }`), so we
 * assert by calling `jsonErr` (which is what the wrapper itself calls) via a
 * real Hono app. The boolean verdict is indirectly proven by the wrapper
 * either returning a 400 response or undefined for each input.
 */
describe("requireValidRoomSlug (Hono wrapper)", () => {
  it("accepts valid room slugs and returns undefined", () => {
    expect(requireValidRoomSlug({} as Context, "general")).toBeUndefined();
    expect(requireValidRoomSlug({} as Context, "dev-tools")).toBeUndefined();
    expect(requireValidRoomSlug({} as Context, "a")).toBeUndefined();
    expect(requireValidRoomSlug({} as Context, "room123")).toBeUndefined();
  });

  it("rejects invalid slugs with a 400 JSON response, aligning with isValidRoomSlug", async () => {
    const app = new Hono();
    app.get("/", (c) => {
      const bad = requireValidRoomSlug(c, "a\nb");
      if (bad) return bad.r;
      return c.text("ok");
    });
    const res = await app.request("/");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad room slug" });
  });

  it("is perfectly aligned with isValidRoomSlug across a broad corpus", () => {
    const corpus = [
      "general",
      "a",
      "9",
      "a-b-c",
      "room-1",
      "9abc",
      "dev-tools",
      "short-",
      "0123456789abcdef0123456789abcd", // 30 chars, max
      // Invalids
      "",
      "-bad",
      "--bad",
      "_private",
      "General",
      "GEN",
      "room\n",
      "a\r\nb",
      "ok\tevent:hack",
      "ok\nevent:hack",
      "room/",
      "room\\back",
      "../etc",
      "room..name",
      "room@domain",
      " room",
      "room ",
      "0123456789abcdef0123456789abcde", // 31 chars, over max
    ];
    // Stub a Hono Context with the minimal surface requireValidRoomSlug needs:
    // jsonErr(c, msg, status) calls c.json({ error: msg }, status), then the
    // returned Response is wrapped in { ok: false, r: Response }. The stub only
    // needs to accept the call — we assert the boolean verdict via the presence
    // or absence of the returned wrapper object.
    const stubCtx = { json: (_: unknown, __: number) => ({}) as Response } as Context;
    for (const s of corpus) {
      const pure = isValidRoomSlug(s);
      const wrapper = requireValidRoomSlug(stubCtx, s);
      const verdict = wrapper === undefined;
      expect(verdict).toBe(pure);
    }
  });
});

// ── parseJsonBody ────────────────────────────────────────────────────

/**
 * `parseJsonBody` wraps `c.req.json()` + Zod `safeParse` into one call.
 * On schema rejection it returns `{ ok: false, r: Response }` so the route
 * handler can early-return. On success it returns the typed payload.
 */
const TestSchema = z.object({ name: z.string(), count: z.number().optional() });
const EmptySchema = z.object({});

function withParseJsonBody(handler: (c: Context) => Promise<Response>) {
  const app = new Hono();
  app.post("/", handler);
  return app;
}

describe("parseJsonBody", () => {
  it("parses valid JSON through the schema", async () => {
    const app = withParseJsonBody(async (c) => {
      const parsed = await parseJsonBody(c, TestSchema, "bad request");
      if (!parsed.ok) return parsed.r;
      return c.json({ name: parsed.data.name, count: parsed.data.count });
    });
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "alice", count: 3 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "alice", count: 3 });
  });

  it("passes through missing optional fields", async () => {
    const app = withParseJsonBody(async (c) => {
      const parsed = await parseJsonBody(c, TestSchema, "bad request");
      if (!parsed.ok) return parsed.r;
      return c.json({ count: parsed.data.count });
    });
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "bob" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: undefined });
  });

  it("rejects JSON that fails the schema with 400", async () => {
    const app = withParseJsonBody(async (c) => {
      const parsed = await parseJsonBody(c, TestSchema, "bad request");
      if (!parsed.ok) return parsed.r;
      return c.json({ ok: true });
    });
    // `count` is a number, but we send a string — Zod rejects.
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "alice", count: "three" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad request" });
  });

  it("rejects a required-field-missing payload with 400", async () => {
    const app = withParseJsonBody(async (c) => {
      const parsed = await parseJsonBody(c, TestSchema, "missing name");
      if (!parsed.ok) return parsed.r;
      return c.json({ ok: true });
    });
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: 5 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing name" });
  });

  it("rejects invalid JSON with a distinct 'invalid JSON' message", async () => {
    const app = withParseJsonBody(async (c) => {
      const parsed = await parseJsonBody(c, TestSchema, "bad request");
      if (!parsed.ok) return parsed.r;
      return c.json({ ok: true });
    });
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json at all",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid JSON" });
  });

  it("distinguishes parse errors from schema rejections", async () => {
    // Parse failure gets "invalid JSON"; schema failure gets the caller's
    // message — so clients and audit logs can tell them apart.
    const app = withParseJsonBody(async (c) => {
      const parsed = await parseJsonBody(c, TestSchema, "missing name");
      if (!parsed.ok) return parsed.r;
      return c.json({ ok: true });
    });
    // Malformed JSON → "invalid JSON"
    let res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "broken{",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid JSON" });
    // Valid JSON but missing required field → caller's message
    res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: 5 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing name" });
  });

  it("rejects arrays (non-object input) with the error message", async () => {
    const app = withParseJsonBody(async (c) => {
      const parsed = await parseJsonBody(c, TestSchema, "unprocessable", 422);
      if (!parsed.ok) return parsed.r;
      return c.json({ ok: true });
    });
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "alice", count: "nope" }),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "unprocessable" });
  });

  it("handles an empty object body against a schema with optional fields", async () => {
    const app = withParseJsonBody(async (c) => {
      const parsed = await parseJsonBody(c, EmptySchema, "bad request");
      if (!parsed.ok) return parsed.r;
      return c.json({ ok: true });
    });
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects arrays (non-object input) with the error message", async () => {
    const app = withParseJsonBody(async (c) => {
      const parsed = await parseJsonBody(c, TestSchema, "bad request");
      if (!parsed.ok) return parsed.r;
      return c.json({ ok: true });
    });
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([1, 2, 3]),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad request" });
  });

  it("uses a custom status when provided", async () => {
    const app = withParseJsonBody(async (c) => {
      const parsed = await parseJsonBody(c, TestSchema, "unprocessable", 422);
      if (!parsed.ok) return parsed.r;
      return c.json({ ok: true });
    });
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "alice", count: "nope" }),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "unprocessable" });
  });

  it("accepts valid JSON on a no-Content-Type request", async () => {
    // Hono parses JSON bodies regardless of Content-Type in its test harness,
    // so valid JSON with a missing header still succeeds via parseJsonBody.
    const app = withParseJsonBody(async (c) => {
      const parsed = await parseJsonBody(c, TestSchema, "bad request");
      if (!parsed.ok) return parsed.r;
      return c.json({ name: parsed.data.name });
    });
    const res = await app.request("/", {
      method: "POST",
      headers: {},
      body: JSON.stringify({ name: "carol" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("name");
  });

  it("rejects an empty body with 'invalid JSON'", async () => {
    const app = withParseJsonBody(async (c) => {
      const parsed = await parseJsonBody(c, TestSchema, "bad request");
      if (!parsed.ok) return parsed.r;
      return c.json({ ok: true });
    });
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid JSON" });
  });
});

// ── withOptionalMiddleware ─────────────────────────────────────────

/**
 * `withOptionalMiddleware` returns `[MiddlewareHandler]` for a real guard
 * and `[noopMiddleware]` for `undefined`, so rate-limited routes can be
 * registered once regardless of NODE_ENV. We assert the no-op path
 * passes requests through unmodified and that the return is always a
 * non-empty array (so the spread operator `...withOptionalMiddleware(m)`
 * is always valid).
 */
describe("withOptionalMiddleware", () => {
  it("returns an array of length 1 when middleware is provided", () => {
    const middleware = async (_c: Context, next: () => Promise<void>) => next();
    expect(withOptionalMiddleware(middleware)).toHaveLength(1);
    expect(withOptionalMiddleware(middleware)[0]).toBe(middleware);
  });

  it("returns an array of length 1 when middleware is undefined (no-op)", () => {
    const result = withOptionalMiddleware(undefined);
    expect(result).toHaveLength(1);
    expect(typeof result[0]).toBe("function");
  });

  it("always returns a non-empty array (spread-safe)", () => {
    expect(withOptionalMiddleware(undefined).length).toBeGreaterThan(0);
    expect(withOptionalMiddleware(async () => {}).length).toBeGreaterThan(0);
  });

  it("reuses the same no-op singleton across undefined calls", () => {
    const a = withOptionalMiddleware(undefined);
    const b = withOptionalMiddleware(undefined);
    expect(a[0]).toBe(b[0]);
  });

  it("no-op placeholder passes requests through unchanged in a real Hono app", async () => {
    const app = new Hono();
    app.post("/", ...withOptionalMiddleware(undefined), (c) =>
      c.json({ status: "ok" }),
    );
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: 1 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
