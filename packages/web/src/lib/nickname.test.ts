import { isBlockingIssue, NICKNAME_RULE,validateNickname } from "@/lib/nickname";
import { describe, expect,it } from "vitest";

describe("validateNickname", () => {
  it("flags empty / whitespace-only names as empty after trim", () => {
    expect(validateNickname("")?.kind).toBe("empty");
    expect(validateNickname("   ")?.kind).toBe("empty");
  });

  it("flags whitespace inside a name as a blocking issue", () => {
    // "Bad Nick!!" — the exact case from the report. Spaces break @-mention
    // tokenization, so this is the one hard block.
    const issue = validateNickname("Bad Nick!!");
    expect(issue).not.toBeNull();
    expect(issue?.kind).toBe("whitespace");
    expect(isBlockingIssue(issue)).toBe(true);
  });

  it("does NOT block CJK names (the mention system supports them)", () => {
    expect(validateNickname("王前端")).toBeNull();
    expect(validateNickname("alice")).toBeNull();
    expect(validateNickname("a_b-1")).toBeNull();
  });

  it("advises (does not block) on length outside the window", () => {
    expect(validateNickname("ab")?.kind).toBe("tooShort");
    // length issues are advisory — they must NOT be blocking
    expect(isBlockingIssue({ kind: "tooShort", min: 3 })).toBe(false);
    const long = "x".repeat(NICKNAME_RULE.max + 1);
    expect(validateNickname(long)?.kind).toBe("tooLong");
  });

  it("accepts names within the advisory length window", () => {
    expect(validateNickname("abc")).toBeNull();
    expect(validateNickname("x".repeat(NICKNAME_RULE.max))).toBeNull();
  });
});

describe("isBlockingIssue", () => {
  it("only treats whitespace as blocking", () => {
    expect(isBlockingIssue(null)).toBe(false);
    expect(isBlockingIssue({ kind: "empty" })).toBe(false);
    expect(isBlockingIssue({ kind: "tooShort", min: 3 })).toBe(false);
    expect(isBlockingIssue({ kind: "tooLong", max: 20 })).toBe(false);
    expect(isBlockingIssue({ kind: "whitespace" })).toBe(true);
  });
});
