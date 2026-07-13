import { describe, it, expect } from "vitest";
import type { Participant } from "@club/shared";
import {
  applyMention,
  detectMention,
  filterMembers,
  MENTION_MAX_VISIBLE,
} from "./mention";

const P = (id: string, name: string): Participant => ({
  id,
  name,
  createdAt: 0,
});

describe("detectMention", () => {
  it("detects a bare `@` just typed at the caret", () => {
    expect(detectMention("hello @", 7)).toEqual({
      start: 6,
      end: 7,
      query: "",
    });
  });

  it("detects `@` followed by a typed token", () => {
    expect(detectMention("hello @al", 9)).toEqual({
      start: 6,
      end: 9,
      query: "al",
    });
  });

  it("detects a `@` at the very start of the text", () => {
    expect(detectMention("@bob", 4)).toEqual({ start: 0, end: 4, query: "bob" });
  });

  it("supports CJK names in the query token", () => {
    expect(detectMention("hi @王前", 6)).toEqual({
      start: 3,
      end: 6,
      query: "王前",
    });
  });

  it("returns null when there is no `@`", () => {
    expect(detectMention("hello world", 11)).toBeNull();
  });

  it("returns null when a space was typed after the token (popup closes)", () => {
    expect(detectMention("hi @bob ", 8)).toBeNull();
  });

  it("returns null when `@` is embedded mid-token (email-style)", () => {
    expect(detectMention("a@b.com", 6)).toBeNull();
  });

  it("returns null when `@` is not preceded by whitespace or start", () => {
    expect(detectMention("foo@bar", 7)).toBeNull();
  });

  it("returns null for caret at position 0", () => {
    expect(detectMention("hello", 0)).toBeNull();
  });

  it("finds the nearest `@` when multiple exist", () => {
    // caret is after the second `@x`, the first `@bob ` is closed by the space
    expect(detectMention("@bob hi @x", 10)).toEqual({
      start: 8,
      end: 10,
      query: "x",
    });
  });
});

describe("filterMembers", () => {
  const roster = [
    P("1", "alice"),
    P("2", "王前端"),
    P("3", "Bob"),
    P("4", "alex"),
    P("5", "robert"),
  ];

  it("filters case-insensitively by substring", () => {
    const out = filterMembers("AL", roster);
    expect(out.map((m) => m.name).sort()).toEqual(["alex", "alice"]);
  });

  it("matches CJK query characters against CJK names", () => {
    const out = filterMembers("王", roster);
    expect(out.map((m) => m.name)).toEqual(["王前端"]);
  });

  it("ranks prefix matches before plain substring matches", () => {
    const out = filterMembers("al", roster);
    // "alice" and "alex" prefix-match; "robert" would only substring-match if
    // it contained "al" — it doesn't, so we just check the two prefix matches.
    expect(out.map((m) => m.name)).toEqual(["alice", "alex"]);
  });

  it("excludes the current user", () => {
    const out = filterMembers("", roster, "1");
    expect(out.find((m) => m.id === "1")).toBeUndefined();
  });

  it("returns the whole roster (minus self) for an empty query", () => {
    const out = filterMembers("", roster);
    expect(out).toHaveLength(roster.length);
  });

  it("skips entries with an empty name", () => {
    const out = filterMembers("", [P("x", "")]);
    expect(out).toEqual([]);
  });

  it("with a large roster, returns more than the visible cap (capping is the popup's job)", () => {
    const big = Array.from({ length: 20 }, (_, i) => P(String(i), `user${i}`));
    expect(filterMembers("user", big)).toHaveLength(20);
    expect(MENTION_MAX_VISIBLE).toBeLessThan(20);
  });
});

describe("applyMention", () => {
  it("replaces the `@query` token with `@name ` and positions the caret after the space", () => {
    // caret at end of `@al` (index 6); the space at 7 closes the live popup
    // but applyMention itself only needs the captured range.
    const q = detectMention("hi @al", 6)!;
    const { text } = applyMention("hi @al please", q, "alice");
    // indices 3..6 (the `@al`) replaced by `@alice `; the original trailing
    // space + "please" remain, yielding two spaces.
    expect(text).toBe("hi @alice  please");
  });

  it("keeps text after the caret intact", () => {
    const q = detectMention("@bo", 3)!;
    const { text } = applyMention("@bo and more", q, "bob");
    expect(text).toBe("@bob  and more");
  });

  it("works for a CJK name", () => {
    const q = detectMention("@王", 2)!;
    const { text, caret } = applyMention("@王 hi", q, "王前端");
    expect(text).toBe("@王前端  hi");
    // caret lands right after "@王前端 "
    expect(text.slice(0, caret)).toBe("@王前端 ");
  });

  it("places the caret immediately after the trailing space", () => {
    const q = detectMention("@al", 3)!;
    const { text, caret } = applyMention("@al", q, "alex");
    expect(caret).toBe("@alex ".length);
    expect(text.slice(0, caret)).toBe("@alex ");
  });
});
