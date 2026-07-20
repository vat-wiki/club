import { describe, expect, it } from "vitest";
import { ClubApiError, formatError } from "./errors";

describe("ClubApiError", () => {
  it("extends Error with the provided message", () => {
    const err = new ClubApiError("not found", 404);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("not found");
  });

  it("sets name to ClubApiError", () => {
    const err = new ClubApiError("gone", 410);
    expect(err.name).toBe("ClubApiError");
  });

  it("records the HTTP status", () => {
    const err = new ClubApiError("rate limited", 429);
    expect(err.status).toBe(429);
  });

  it("uses status 0 for network failures with no response", () => {
    const err = new ClubApiError("fetch failed", 0);
    expect(err.status).toBe(0);
  });

  it("preserves standard Error properties like stack", () => {
    const err = new ClubApiError("timeout", 504);
    expect(err.stack).toBeDefined();
  });
});

describe("formatError", () => {
  it("returns the message from an Error instance", () => {
    expect(formatError(new Error("real error"))).toBe("real error");
  });

  it("passes through strings unchanged", () => {
    expect(formatError("literal failure")).toBe("literal failure");
  });

  it("converts undefined to 'undefined'", () => {
    expect(formatError(undefined)).toBe("undefined");
  });

  it("converts null to 'null'", () => {
    expect(formatError(null)).toBe("null");
  });

  it("converts numbers via String()", () => {
    expect(formatError(42)).toBe("42");
  });

  it("converts plain objects to '[object Object]'", () => {
    expect(formatError({ reason: "bad" })).toBe("[object Object]");
  });
});
