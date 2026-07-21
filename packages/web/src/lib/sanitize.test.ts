import { describe, expect, it } from "vitest";

import { sanitizeDisplayString, truncateDisplayString } from "./sanitize.js";

describe("sanitizeDisplayString", () => {
  it("returns empty string for non-string input", () => {
    expect(sanitizeDisplayString(null as any)).toBe("");
    expect(sanitizeDisplayString(undefined as any)).toBe("");
    expect(sanitizeDisplayString(42 as any)).toBe("");
  });

  it("passes through normal text unchanged", () => {
    expect(sanitizeDisplayString("hello world")).toBe("hello world");
    expect(sanitizeDisplayString("王前端")).toBe("王前端");
  });

  it("preserves tabs and newlines (renderContent uses whitespace-pre-wrap)", () => {
    expect(sanitizeDisplayString("a\tb")).toBe("a\tb");
    expect(sanitizeDisplayString("line1\nline2")).toBe("line1\nline2");
    expect(sanitizeDisplayString("a\r\nb")).toBe("a\r\nb");
  });

  it("removes NUL bytes", () => {
    expect(sanitizeDisplayString("hel\x00lo")).toBe("hello");
  });

  it("removes C0 controls (U+0000..U+0008)", () => {
    expect(sanitizeDisplayString("a\x01b\x02c")).toBe("abc");
    expect(sanitizeDisplayString("\x08back")).toBe("back");
  });

  it("removes VT and FF (U+000b, U+000c)", () => {
    expect(sanitizeDisplayString("a\x0bb")).toBe("ab");
    expect(sanitizeDisplayString("a\x0cb")).toBe("ab");
  });

  it("removes DEL (U+007f)", () => {
    expect(sanitizeDisplayString("a\x7fb")).toBe("ab");
  });

  it("removes a range of invisible controls (U+000e..U+001f)", () => {
    expect(sanitizeDisplayString("a\x0eb\x0fc\x1fd")).toBe("abcd");
  });

  it("strips controls from a malicious combined payload", () => {
    // NUL injection + VT + DEL + low controls
    expect(sanitizeDisplayString("hi\x00\x0b\x7fbye")).toBe("hibye");
  });

  it("removes zero-width chars is out of scope — only ASCII controls stripped", () => {
    // zero-width joiner/non-joiner are Unicode (U+200D / U+200C), not ASCII
    // controls; this module mirrors the server's ASCII-only strip.
    expect(sanitizeDisplayString("ab\u200Dc")).toBe("ab\u200Dc");
  });

  it("handles empty and whitespace-only strings", () => {
    expect(sanitizeDisplayString("")).toBe("");
    expect(sanitizeDisplayString("   ")).toBe("   ");
  });
});

describe("truncateDisplayString", () => {
  it("passes short strings through unchanged", () => {
    expect(truncateDisplayString("short", 10)).toBe("short");
  });

  it("truncates at maxChars and appends ellipsis", () => {
    const out = truncateDisplayString("hello world", 8);
    expect(out).toBe("hello w…");
  });

  it("sanitizes controls before applying the cap", () => {
    // NUL + DEL inflate raw length but get stripped; cap applies to clean text.
    const raw = "a".repeat(9) + "\x00\x7f" + "b".repeat(2); // 12 raw chars, 11 clean
    expect(truncateDisplayString(raw, 10)).toBe("aaaaaaaaaa…");
  });

  it("uses custom ellipsis", () => {
    expect(truncateDisplayString("abcdef", 5, ">>")).toBe("abcde>>");
  });

  it("caps at default 10_000", () => {
    const long = "x".repeat(12_000);
    expect(truncateDisplayString(long).length).toBe(10_000); // 9_999 + "…"
    expect(truncateDisplayString(long)).toBe("x".repeat(9_999) + "…");
  });
});
