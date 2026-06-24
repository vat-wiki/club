import { describe, it, expect } from "vitest";
import { str, num, clampLimit } from "./helpers.js";

describe("str", () => {
  it("returns a real string unchanged", () => {
    expect(str("hello")).toBe("hello");
    expect(str("")).toBe("");
  });

  it("returns empty string for anything that is not a string", () => {
    expect(str(undefined)).toBe("");
    expect(str(null)).toBe("");
    expect(str(123)).toBe("");
    expect(str({})).toBe("");
    expect(str(["x"])).toBe("");
  });
});

describe("num", () => {
  it("returns the number when given a number", () => {
    expect(num(42)).toBe(42);
    expect(num(0)).toBe(0);
    expect(num(-1.5)).toBe(-1.5);
  });

  it("returns undefined for non-numbers", () => {
    expect(num(undefined)).toBeUndefined();
    expect(num(null)).toBeUndefined();
    expect(num("42")).toBeUndefined();
    expect(num("not a number")).toBeUndefined();
  });

  // Pinned explicitly: num() does NOT filter NaN/Infinity — call sites rely on
  // `??` (which only catches null/undefined), so non-finite values flow through.
  it("passes NaN and Infinity through unchanged (legacy behavior)", () => {
    expect(num(NaN)).toBeNaN();
    expect(num(Infinity)).toBe(Infinity);
    expect(num(-Infinity)).toBe(-Infinity);
  });
});

describe("clampLimit", () => {
  it("defaults to 50 for non-numbers", () => {
    expect(clampLimit(undefined)).toBe(50);
    expect(clampLimit(null)).toBe(50);
    expect(clampLimit("100")).toBe(50);
    expect(clampLimit({})).toBe(50);
  });

  it("defaults to 50 for non-finite numbers (hardened)", () => {
    expect(clampLimit(NaN)).toBe(50);
    expect(clampLimit(Infinity)).toBe(50);
    expect(clampLimit(-Infinity)).toBe(50);
  });

  it("clamps values below 1 up to 1", () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(0.4)).toBe(1);
  });

  it("clamps values above 500 down to 500", () => {
    expect(clampLimit(501)).toBe(500);
    expect(clampLimit(99999)).toBe(500);
  });

  it("floors fractional values within range", () => {
    expect(clampLimit(10.9)).toBe(10);
    expect(clampLimit(1.5)).toBe(1);
    expect(clampLimit(499.99)).toBe(499);
  });

  it("keeps valid integers within range unchanged", () => {
    expect(clampLimit(1)).toBe(1);
    expect(clampLimit(50)).toBe(50);
    expect(clampLimit(250)).toBe(250);
    expect(clampLimit(500)).toBe(500);
  });
});
