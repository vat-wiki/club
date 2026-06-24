import { describe, it, expect } from "vitest";
import { parseLimit } from "./lib.js";

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
