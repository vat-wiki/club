import { describe, expect, it } from "vitest";

import { escapeLike } from "./escape-like.js";

describe("escapeLike", () => {
  it("returns an empty string unchanged", () => {
    expect(escapeLike("")).toBe("");
  });

  it("leaves safe characters untouched", () => {
    expect(escapeLike("hello")).toBe("hello");
    expect(escapeLike("2026-07-21")).toBe("2026-07-21");
    expect(escapeLike("agent/agent-id")).toBe("agent/agent-id");
  });

  it("escapes literal backslash by doubling", () => {
    expect(escapeLike("\\")).toBe("\\\\");
    expect(escapeLike("a\\b")).toBe("a\\\\b");
    expect(escapeLike("foo\\bar\\baz")).toBe("foo\\\\bar\\\\baz");
  });

  it("escapes the percent wildcard", () => {
    expect(escapeLike("%")).toBe("\\%");
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("foo%bar%baz")).toBe("foo\\%bar\\%baz");
  });

  it("escapes the underscore wildcard", () => {
    expect(escapeLike("_")).toBe("\\_");
    expect(escapeLike("id_123")).toBe("id\\_123");
  });

  it("applies all three escapes in the correct order (backslash first)", () => {
    // A literal backslash that precedes a % or _ must survive; backslash
    // is doubled first, then % and _ are prefixed independently.
    expect(escapeLike("\\%")).toBe("\\\\\\%");
    expect(escapeLike("\\_")).toBe("\\\\\\_");
    expect(escapeLike("\\%_")).toBe("\\\\\\%\\_");
  });

  it("escapes a real LIKE-wildcard injection payload", () => {
    // These should NOT match anything but the literal string.
    expect(escapeLike("%_")).toBe("\\%\\_");
    expect(escapeLike("_%")).toBe("\\_\\%");
    expect(escapeLike("\\_\\%")).toBe("\\\\\\_\\\\\\%");
  });

  it("handles mixed safe + wildcard content", () => {
    expect(escapeLike("user@host_100%")).toBe("user@host\\_100\\%");
  });
});
