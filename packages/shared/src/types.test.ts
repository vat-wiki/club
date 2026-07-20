import { describe, expect, it } from "vitest";
import { ParticipantName } from "./types";

describe("ParticipantName schema", () => {
  const valid = [
    ["alice", "alice"],
    ["Bob", "Bob"],
    ["O'Connor", "O'Connor"],
    ["Jean-Paul", "Jean-Paul"],
    ["first.last", "first.last"],
    ["under_score", "under_score"],
    ["123", "123"],
    ["中文名字", "中文名字"],
    ["日本語", "日本語"],
    ["한국어", "한국어"],
    ["Ñoño", "Ñoño"],
    ["José García", "José García"],
    ["a b c d e f g h i j", "a b c d e f g h i j"],
    ["a\n\u00A0b".replace("\n", ""), "a b"], // non-breaking space is allowed
  ];

  it.each(valid)("parses %p", (input, expected) => {
    expect(ParticipantName.parse(input)).toBe(expected);
  });

  // ── Whitespace-only / leading-trailing whitespace ──

  it.each([
    ["   ", "whitespace-only (spaces)"],
    ["\u00A0\u00A0", "whitespace-only (non-breaking)"],
    [" Alice", "leading space"],
    ["Alice ", "trailing space"],
    [" \u00A0Bob\u00A0 ", "mixed leading/trailing space + NBSP"],
  ] as const)("rejects %p", (input) => {
    expect(() => ParticipantName.parse(input)).toThrow();
  });

  it("allows single-character names", () => {
    expect(ParticipantName.parse("A")).toBe("A");
    expect(ParticipantName.parse("_")).toBe("_");
    expect(ParticipantName.parse(".")).toBe(".");
  });

  it("allows multi-word names with internal whitespace", () => {
    expect(ParticipantName.parse("José García")).toBe("José García");
    expect(ParticipantName.parse("a b c d e f g h i j")).toBe(
      "a b c d e f g h i j",
    );
  });

  const invalid = [
    ["", "empty string"],
    ["a".repeat(41), "longer than 40 chars"],
    ["bad\nname", "CRLF / newline"],
    ["bad\rname", "carriage return"],
    ["bad\tname", "tab (control)"],
    ["bad\x00name", "null byte"],
    ["bad\x1Fname", "unit separator (control)"],
    ["bad\x7Fname", "DEL"],
    ["bad\u200Bname", "zero-width space"],
    ["bad\u200Ename", "left-to-right mark"],
    ["bad\u200Fname", "right-to-left mark"],
    ["bad\u2028name", "line separator"],
    ["bad\u2029name", "paragraph separator"],
    ["bad\u2066name", "isolate mark"],
    ["bad\u206Fname", "pop directional isolate"],
    ["bad\uFEFFname", "BOM"],
    ["bad/name", "slash not in whitelist"],
    ["bad<name>", "angle brackets not in whitelist"],
    ["bad:name", "colon not in whitelist"],
  ];

  it.each(invalid)("rejects %p", (input) => {
    expect(() => ParticipantName.parse(input)).toThrow();
  });
});
