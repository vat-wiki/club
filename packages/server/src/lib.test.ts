import type { Context } from "hono";
import { Hono } from "hono";
import { ROOM_SLUG_REGEX } from "@club/shared";
import { describe, it, expect } from "vitest";
import { jsonErr, parseLimit, parseBearer, isValidRoomSlug, requireValidRoomSlug } from "./lib.js";

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

describe("requireValidRoomSlug", () => {
  it("accepts valid room slugs", () => {
    expect(requireValidRoomSlug({} as Context, "general")).toBeUndefined();
    expect(requireValidRoomSlug({} as Context, "dev-tools")).toBeUndefined();
    expect(requireValidRoomSlug({} as Context, "a")).toBeUndefined();
    expect(requireValidRoomSlug({} as Context, "room123")).toBeUndefined();
  });

  it("accepts every ROOM_SLUG_REGEX token as a valid slug", () => {
    const tokens = [
      "a", "a-b-c", "room-1", "9abc", "general",
      "short-", "a0b1c2d3e4f5g6h7i8j9k0l1m2n", // max 30 chars
    ];
    for (const t of tokens) {
      expect(ROOM_SLUG_REGEX.test(t)).toBe(true);
      expect(isValidRoomSlug(t)).toBe(true);
      expect(requireValidRoomSlug({} as Context, t)).toBeUndefined();
    }
  });

  it("rejects a room slug containing a newline (CRLF injection)", () => {
    expect(isValidRoomSlug("room\n")).toBe(false);
    expect(isValidRoomSlug("a\r\nb")).toBe(false);
    expect(isValidRoomSlug("ok\nevent:hack")).toBe(false);
  });

  it("rejects a room slug containing a path separator", () => {
    expect(isValidRoomSlug("room/slash")).toBe(false);
    expect(isValidRoomSlug("room\\back")).toBe(false);
  });

  it("rejects a room slug containing traversal tokens", () => {
    expect(isValidRoomSlug("../etc")).toBe(false);
    expect(isValidRoomSlug("room..name")).toBe(false);
  });

  it("rejects an uppercase or empty room slug", () => {
    expect(isValidRoomSlug("General")).toBe(false);
    expect(isValidRoomSlug("")).toBe(false);
    expect(isValidRoomSlug("_private")).toBe(false);
    expect(isValidRoomSlug("--bad")).toBe(false);
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
