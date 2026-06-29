import { describe, it, expect } from "vitest";
import { mentionMatches } from "./mention.js";

describe("mentionMatches", () => {
  it("matches a literal @mention", () => {
    expect(mentionMatches("hey @alice", "alice")).toBe(true);
    expect(mentionMatches("@alice please review", "alice")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(mentionMatches("hey @Alice", "alice")).toBe(true);
    expect(mentionMatches("hey @alice", "ALICE")).toBe(true);
    expect(mentionMatches("HEY @AlIcE", "alice")).toBe(true);
  });

  it("requires the @ prefix — a bare name is not a mention", () => {
    expect(mentionMatches("alice will handle it", "alice")).toBe(false);
    expect(mentionMatches("talk to alice", "alice")).toBe(false);
  });

  it("returns false for an empty name", () => {
    expect(mentionMatches("hey @alice", "")).toBe(false);
  });

  it("does NOT let a short name match a longer @-tag (trailing word boundary)", () => {
    expect(mentionMatches("ping @alicia", "al")).toBe(false);
    expect(mentionMatches("see @editorial", "ed")).toBe(false);
    expect(mentionMatches("msg @wangwen", "wang")).toBe(false);
  });

  it("still matches the full name when a shorter prefix name also exists", () => {
    expect(mentionMatches("msg @wangwen", "wangwen")).toBe(true);
    // A standalone shorter tag still matches even if a longer one appears too.
    expect(mentionMatches("hi @wang and @wangwen", "wang")).toBe(true);
  });

  it("handles CJK names and their prefix collisions", () => {
    // 走查-体验 is a prefix of 走查-体验2 — @-ing the longer must not ping the shorter.
    expect(mentionMatches("@走查-体验2 看下", "走查-体验")).toBe(false);
    expect(mentionMatches("@走查-体验2 看下", "走查-体验2")).toBe(true);
    expect(mentionMatches("@王测试 hi", "王测试")).toBe(true);
  });

  it("treats trailing punctuation and end-of-string as a boundary", () => {
    expect(mentionMatches("@alice, ping", "alice")).toBe(true);
    expect(mentionMatches("@alice!", "alice")).toBe(true);
    expect(mentionMatches("@alice", "alice")).toBe(true);
  });

  it("does not match a different name", () => {
    expect(mentionMatches("hey @alice", "bob")).toBe(false);
    expect(mentionMatches("anyone there?", "alice")).toBe(false);
  });
});
