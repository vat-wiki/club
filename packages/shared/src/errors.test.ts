import { describe, expect, it } from "vitest";
import {
  ClubApiError,
  NETWORK_ERROR_STATUS,
  formatError,
  isClubApiError,
} from "./errors";

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

describe("isClubApiError", () => {
  it("accepts a genuine ClubApiError", () => {
    const err = new ClubApiError("not found", 404);
    expect(isClubApiError(err)).toBe(true);
  });

  it("accepts the network-failure sentinel status 0", () => {
    const err = new ClubApiError("no response", 0);
    expect(err.status).toBe(NETWORK_ERROR_STATUS);
    expect(isClubApiError(err)).toBe(true);
  });

  it("rejects an Error subclass that is not ClubApiError", () => {
    expect(isClubApiError(new TypeError("oops"))).toBe(false);
  });

  it("rejects a plain object that impersonates the shape", () => {
    const fake = { name: "ClubApiError", message: "fake", status: 404 };
    expect(isClubApiError(fake)).toBe(false);
  });

  it("rejects a ClubApiError whose status was widened at runtime to a non-integer", () => {
    const err = new ClubApiError("ok", 404);
    // Deliberately widen the type to provoke the guard at runtime.
    (err as unknown as { status: string }).status = "NaN" as unknown as 404;
    expect(isClubApiError(err)).toBe(false);
  });

  it("rejects a ClubApiError with a negative status", () => {
    const err = new ClubApiError("ok", 404);
    (err as unknown as { status: number }).status = -1;
    expect(isClubApiError(err)).toBe(false);
  });

  it("rejects primitives", () => {
    expect(isClubApiError("a string")).toBe(false);
    expect(isClubApiError(null)).toBe(false);
    expect(isClubApiError(undefined)).toBe(false);
  });
});

describe("NETWORK_ERROR_STATUS", () => {
  it("is the literal 0", () => {
    expect(NETWORK_ERROR_STATUS).toBe(0);
  });

  it("can be used to branch a synthetic-network error from a real HTTP status", () => {
    const net = new ClubApiError("dns failure", NETWORK_ERROR_STATUS);
    const http = new ClubApiError("gone", 410);
    expect(net.status).toBe(NETWORK_ERROR_STATUS);
    expect(http.status).not.toBe(NETWORK_ERROR_STATUS);
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
