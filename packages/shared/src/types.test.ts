import { describe, expect, it } from "vitest";

import {
  CreateParticipantRequest,
  MAX_BIO,
  ParticipantBio,
  ParticipantName,
  UpdateProfileRequest,
} from "./types";

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

describe("ParticipantBio schema", () => {
  it("defaults to empty string when omitted", () => {
    expect(ParticipantBio.parse(undefined)).toBe("");
  });

  it("parses a valid bio", () => {
    expect(ParticipantBio.parse("运维 agent，常驻 :6600")).toBe(
      "运维 agent，常驻 :6600",
    );
  });

  it("strips control chars incl. newlines/tabs (single-line)", () => {
    expect(ParticipantBio.parse("line1\nline2\tend")).toBe("line1line2end");
    expect(ParticipantBio.parse("a\x00b\x7fc")).toBe("abc");
  });

  it("rejects bios longer than MAX_BIO", () => {
    expect(() => ParticipantBio.parse("a".repeat(MAX_BIO + 1))).toThrow();
    expect(ParticipantBio.parse("a".repeat(MAX_BIO))).toBe(
      "a".repeat(MAX_BIO),
    );
  });

  it("preserves CJK and emoji", () => {
    expect(ParticipantBio.parse("产品经理 🚀")).toBe("产品经理 🚀");
  });
});

describe("CreateParticipantRequest", () => {
  it("accepts name only (bio defaults to empty)", () => {
    expect(CreateParticipantRequest.parse({ name: "alice" })).toEqual({
      name: "alice",
      bio: "",
    });
  });

  it("accepts name + bio", () => {
    expect(
      CreateParticipantRequest.parse({ name: "alice", bio: "运维" }),
    ).toEqual({ name: "alice", bio: "运维" });
  });

  it("strips unknown fields (non-strict, graceful deprecation)", () => {
    expect(
      CreateParticipantRequest.parse({ name: "alice", kind: "agent" }),
    ).toEqual({ name: "alice", bio: "" });
  });
});

describe("UpdateProfileRequest", () => {
  it("parses a bio", () => {
    expect(UpdateProfileRequest.parse({ bio: "新角色" })).toEqual({
      bio: "新角色",
    });
  });

  it("defaults missing bio to empty (clears bio)", () => {
    expect(UpdateProfileRequest.parse({})).toEqual({ bio: "" });
  });

  it("rejects unknown fields (strict)", () => {
    expect(() => UpdateProfileRequest.parse({ bio: "x", extra: 1 })).toThrow();
  });
});
