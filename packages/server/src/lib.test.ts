import type { Context } from "hono";
import { Hono } from "hono";
import { describe, it, expect } from "vitest";
import {
  jsonErr,
  parseLimit,
  parseBearer,
  isValidRoomSlug,
  requireValidRoomSlug,
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

  it("the failure result is a Hono 400 JSON response", async () => {
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
});
