import { describe, expect,it } from "vitest";

import { parseLimit } from "./limit.js";

describe("parseLimit", () => {
  it("parses a plain in-range integer", () => {
    expect(parseLimit("50")).toBe(50);
    expect(parseLimit("1")).toBe(1);
    expect(parseLimit("250")).toBe(250);
    expect(parseLimit("500")).toBe(500);
  });

  it("defaults to 50 when the value is missing or blank", () => {
    expect(parseLimit(undefined)).toBe(50);
    expect(parseLimit("")).toBe(50);
    expect(parseLimit("   ")).toBe(50);
  });

  it("defaults to 50 for non-numeric / non-finite input", () => {
    expect(parseLimit("abc")).toBe(50); // NaN
    expect(parseLimit("Infinity")).toBe(50);
    expect(parseLimit("-Infinity")).toBe(50);
  });

  // The bug this fixes: negatives used to be truthy and leaked to the server,
  // which silently clamped them to its own (different) default. Now they clamp
  // to the [1,500] floor client-side, matching the server and MCP clients.
  it("clamps negatives and zero up to the minimum of 1", () => {
    expect(parseLimit("-5")).toBe(1);
    expect(parseLimit("-1")).toBe(1);
    expect(parseLimit("0")).toBe(1);
    expect(parseLimit("-99999")).toBe(1);
  });

  it("clamps values above 500 down to 500", () => {
    expect(parseLimit("501")).toBe(500);
    expect(parseLimit("99999")).toBe(500);
    expect(parseLimit("1e9")).toBe(500);
  });

  it("floors fractional values within range", () => {
    expect(parseLimit("2.9")).toBe(2);
    expect(parseLimit("0.5")).toBe(1); // floors to 0, then clamps up to 1
    expect(parseLimit("499.99")).toBe(499);
  });
});
