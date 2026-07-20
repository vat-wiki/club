import { describe, expect,it } from "vitest";

import {
  parseFlagLimit,
  parseQueryLimit,
  parseToolLimit,
} from "./types.js";

// Shared core: clamp a known-positive finite number to [1, 500].
// Mirrors the implementation in ./types.ts so we can assert its behavior.
const clampPositive = (n: number) => Math.min(Math.max(1, Math.floor(n)), 500);

describe("clampPositive (internal helper)", () => {
  it("clamps high values to 500", () => {
    expect(clampPositive(1000)).toBe(500);
    expect(clampPositive(500)).toBe(500);
  });

  it("keeps valid values unchanged", () => {
    expect(clampPositive(50)).toBe(50);
    expect(clampPositive(250)).toBe(250);
    expect(clampPositive(1)).toBe(1);
  });

  it("floors fractional values", () => {
    expect(clampPositive(100.9)).toBe(100);
  });
});

describe("parseQueryLimit (server routes)", () => {
  it("uses fallback for undefined/empty", () => {
    expect(parseQueryLimit(undefined)).toBe(100);
    expect(parseQueryLimit(undefined, 25)).toBe(25);
  });

  it("parses valid number input", () => {
    expect(parseQueryLimit(50)).toBe(50);
    expect(parseQueryLimit(1)).toBe(1);
    expect(parseQueryLimit(500)).toBe(500);
    expect(parseQueryLimit(1000)).toBe(500);
    expect(parseQueryLimit(100.9)).toBe(100);
  });

  it("falls back for non-finite / zero / negative input (SQL LIMIT safety)", () => {
    // Negative LIMIT in SQLite means "no limit" — we treat these as malformed
    // and fall back to the default rather than clamp to 1.
    expect(parseQueryLimit(-5)).toBe(100);
    expect(parseQueryLimit(0)).toBe(100);
    expect(parseQueryLimit(NaN)).toBe(100);
    expect(parseQueryLimit(Infinity)).toBe(100);
    expect(parseQueryLimit(-Infinity)).toBe(100);
  });

  it("parses valid string input", () => {
    expect(parseQueryLimit("200")).toBe(200);
    expect(parseQueryLimit("1")).toBe(1);
    expect(parseQueryLimit("9999")).toBe(500);
  });

  it("falls back for malformed string input", () => {
    expect(parseQueryLimit("abc")).toBe(100);
    // Number("") === 0 (finite, but <= 0) -> fallback
    expect(parseQueryLimit("")).toBe(100);
    expect(parseQueryLimit("   ")).toBe(100);
  });
});

describe("parseFlagLimit (CLI)", () => {
  it("uses fallback for undefined/empty", () => {
    expect(parseFlagLimit(undefined)).toBe(50);
    expect(parseFlagLimit("")).toBe(50);
    expect(parseFlagLimit("   ")).toBe(50);
  });

  it("parses valid numeric strings (incl. 0/negatives clamped to 1)", () => {
    expect(parseFlagLimit("50")).toBe(50);
    expect(parseFlagLimit("500")).toBe(500);
    expect(parseFlagLimit("-5")).toBe(1);
    expect(parseFlagLimit("0")).toBe(1);
    expect(parseFlagLimit("1000")).toBe(500);
    expect(parseFlagLimit("100.9")).toBe(100);
  });

  it("uses fallback for non-finite values", () => {
    expect(parseFlagLimit("abc")).toBe(50);
    expect(parseFlagLimit("Infinity")).toBe(50);
  });
});

describe("parseToolLimit (MCP)", () => {
  it("uses fallback for null/undefined/non-number/non-string", () => {
    expect(parseToolLimit(null)).toBe(50);
    expect(parseToolLimit(undefined)).toBe(50);
    expect(parseToolLimit({})).toBe(50);
    expect(parseToolLimit([])).toBe(50);
    expect(parseToolLimit(true)).toBe(50);
  });

  it("parses valid number input (0/negatives clamped to 1)", () => {
    expect(parseToolLimit(100)).toBe(100);
    expect(parseToolLimit(-1)).toBe(1);
    expect(parseToolLimit(0)).toBe(1);
    expect(parseToolLimit(1)).toBe(1);
    expect(parseToolLimit(500)).toBe(500);
    expect(parseToolLimit(1000)).toBe(500);
    expect(parseToolLimit(100.9)).toBe(100);
  });

  it("falls back for non-finite numbers", () => {
    expect(parseToolLimit(NaN)).toBe(50);
    expect(parseToolLimit(Infinity)).toBe(50);
    expect(parseToolLimit(-Infinity)).toBe(50);
  });

  it("parses valid string input (0/negatives clamped to 1)", () => {
    expect(parseToolLimit("75")).toBe(75);
    expect(parseToolLimit("-1")).toBe(1);
    expect(parseToolLimit("0")).toBe(1);
  });

  it("falls back for non-numeric strings", () => {
    expect(parseToolLimit("abc")).toBe(50);
  });

  it("uses custom fallback", () => {
    expect(parseToolLimit(null, 30)).toBe(30);
  });
});
