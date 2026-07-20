import { describe, expect, it } from "vitest";
import {
  ClubApiError,
  NETWORK_ERROR_STATUS,
  formatError,
  isClubApiError,
  isNetworkFailure,
  parseHttpErrorStatus,
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

describe("isNetworkFailure", () => {
  it("returns true for the network-failure sentinel", () => {
    expect(isNetworkFailure(NETWORK_ERROR_STATUS)).toBe(true);
  });

  it("returns false for a normal HTTP status", () => {
    expect(isNetworkFailure(404)).toBe(false);
    expect(isNetworkFailure(500)).toBe(false);
    expect(isNetworkFailure(429)).toBe(false);
  });

  it("narrows the type at compile time (smoke)", () => {
    const status: typeof NETWORK_ERROR_STATUS | 404 | 500 = 0;
    if (isNetworkFailure(status)) {
      // Compiler proves `status` is NetworkFailureStatus here.
      expect(typeof status).toBe("number");
      expect(status).toBe(0);
    }
  });
});

describe("parseHttpErrorStatus", () => {
  it("passes through the network-failure sentinel", () => {
    expect(parseHttpErrorStatus(NETWORK_ERROR_STATUS)).toBe(0);
  });

  it("returns valid HTTP status codes unchanged", () => {
    expect(parseHttpErrorStatus(100)).toBe(100);
    expect(parseHttpErrorStatus(200)).toBe(200);
    expect(parseHttpErrorStatus(404)).toBe(404);
    expect(parseHttpErrorStatus(500)).toBe(500);
    expect(parseHttpErrorStatus(511)).toBe(511);
  });

  it("throws on a status below the 100..511 range (except the network sentinel 0)", () => {
    // 0 is the NETWORK_ERROR_STATUS sentinel and is allowed through.
    expect(parseHttpErrorStatus(0)).toBe(0);
    expect(() => parseHttpErrorStatus(99)).toThrow(TypeError);
    expect(() => parseHttpErrorStatus(-1)).toThrow(TypeError);
    expect(() => parseHttpErrorStatus(512)).toThrow(TypeError);
    expect(() => parseHttpErrorStatus(999)).toThrow(TypeError);
  });

  it("throws on non-integer or non-number values", () => {
    expect(() => parseHttpErrorStatus(404.5)).toThrow(TypeError);
    expect(() => parseHttpErrorStatus(Number.NaN)).toThrow(TypeError);
    expect(() => parseHttpErrorStatus(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});
