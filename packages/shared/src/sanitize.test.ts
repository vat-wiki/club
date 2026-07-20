import { describe, expect,it } from "vitest";

import { sanitizeContent } from "./sanitize.js";

describe("sanitizeContent", () => {
  it("strips NUL byte", () => {
    expect(sanitizeContent("hello\x00world")).toBe("helloworld");
  });

  it("strips SOH through unit separator (\\x01-\\x08)", () => {
    expect(sanitizeContent("\x01mid\x07")).toBe("mid");
  });

  it("strips \\x0e-\\x1f range (STX, ESC, etc.)", () => {
    expect(sanitizeContent("\x0emid\x1f")).toBe("mid");
  });

  it("strips DEL (\\x7f)", () => {
    expect(sanitizeContent("a\x7fb")).toBe("ab");
  });

  it("strips mixed control chars in one shot", () => {
    expect(sanitizeContent("\x00\x03\x1f\x7fok\n")).toBe("ok\n");
  });

  it("preserves TAB, LF, CR, and multi-line text", () => {
    const inVal = "line1\nline2\r\nline3\tindented";
    expect(sanitizeContent(inVal)).toBe(inVal);
  });

  it("strips vertical tab (\\x0b) and form feed (\\x0c)", () => {
    expect(sanitizeContent("a\x0bb\x0cc")).toBe("abc");
  });

  it("preserves CJK characters", () => {
    expect(sanitizeContent("你好世界")).toBe("你好世界");
    expect(sanitizeContent("こんにちは\x00")).toBe("こんにちは");
  });

  it("preserves emoji", () => {
    expect(sanitizeContent("👍🎉\x00🚀")).toBe("👍🎉🚀");
  });

  it("preserves leading/trailing whitespace (spaces)", () => {
    expect(sanitizeContent("  spaced  ")).toBe("  spaced  ");
  });

  it("returns empty string when input is all control chars", () => {
    expect(sanitizeContent("\x00\x01\x1f\x7f")).toBe("");
  });

  it("is a no-op for plain English text", () => {
    expect(sanitizeContent("just a normal message")).toBe("just a normal message");
  });

  it("works on empty string", () => {
    expect(sanitizeContent("")).toBe("");
  });
});
