import { beforeEach,describe, expect, it } from "vitest";

import { extractMentionedParticipants, invalidateParticipantNameMap, type NamedParticipant } from "./mention.js";

const P = (id: string, name: string): NamedParticipant => ({ id, name });

// Reset the lazy cache between tests so roster snapshots don't leak across
// test cases (the size-based rebuild check would otherwise skip a rebuild
// when the cached map happened to match the previous test's roster size).
beforeEach(invalidateParticipantNameMap);

describe("extractMentionedParticipants", () => {
  it("matches a literal @mention", () => {
    expect(extractMentionedParticipants("hey @alice", [P("1", "alice")])).toEqual([
      P("1", "alice"),
    ]);
    expect(
      extractMentionedParticipants("@alice please review", [P("1", "alice")]),
    ).toEqual([P("1", "alice")]);
  });

  it("matches case-insensitively (aligned with client-side listen/matchesMention)", () => {
    expect(extractMentionedParticipants("hey @Alice", [P("1", "alice")])).toEqual([
      P("1", "alice"),
    ]);
    expect(extractMentionedParticipants("HEY @AlIcE", [P("1", "alice")])).toEqual([
      P("1", "alice"),
    ]);
  });

  it("does not match a bare name without the @ prefix", () => {
    // This is the deliberate client-side rule: "alice will handle it" is NOT a
    // mention of alice. Server-side parsing must agree so the inbox doesn't
    // diverge from what `club listen --mention alice` would catch.
    expect(extractMentionedParticipants("alice will handle it", [P("1", "alice")])).toEqual([]);
    expect(extractMentionedParticipants("talk to alice", [P("1", "alice")])).toEqual([]);
  });

  it("matches multiple distinct @mentions in one message", () => {
    const roster = [P("1", "alice"), P("2", "bob"), P("3", "carol")];
    expect(extractMentionedParticipants("@alice and @bob, ping", roster)).toEqual([
      P("1", "alice"),
      P("2", "bob"),
    ]);
  });

  it("mentions a participant at most once even if @-repeated in the text", () => {
    expect(
      extractMentionedParticipants("@alice @alice @alice", [P("1", "alice")]),
    ).toEqual([P("1", "alice")]);
  });

  it("mentions a participant at most once even if listed twice in the roster", () => {
    // Defensive: roster shouldn't contain dup ids, but de-dup guards the
    // UNIQUE(message_id, participant_id) insert anyway.
    expect(
      extractMentionedParticipants("hi @alice", [P("1", "alice"), P("1", "alice")]),
    ).toEqual([P("1", "alice")]);
  });

  it("does not let a short name match a longer @-tag (word boundary, via shared mentionMatches)", () => {
    // A short name must NOT be mentioned by a longer @-tag: "@alicia" is not a
    // mention of "al". The rule is shared with cli/mcp through @club/shared.
    expect(extractMentionedParticipants("ping @alicia", [P("1", "al")])).toEqual([]);
    expect(extractMentionedParticipants("see @editorial", [P("1", "ed")])).toEqual([]);
    // CJK prefix collision that actually occurred in the room: 走查-体验 is a
    // prefix of 走查-体验2, so @走查-体验2 must ping only 走查-体验2, not 走查-体验.
    const roster = [P("1", "走查-体验"), P("2", "走查-体验2")];
    expect(extractMentionedParticipants("@走查-体验2 看下", roster)).toEqual([
      P("2", "走查-体验2"),
    ]);
  });

  it("does not match participants who aren't @-mentioned", () => {
    const roster = [P("1", "alice"), P("2", "bob")];
    expect(extractMentionedParticipants("hey @bob", roster)).toEqual([P("2", "bob")]);
    expect(extractMentionedParticipants("anyone there?", roster)).toEqual([]);
  });

  it("returns nothing for an empty roster", () => {
    expect(extractMentionedParticipants("hey @alice", [])).toEqual([]);
  });

  it("skips roster entries with an empty name (would match any '@')", () => {
    expect(
      extractMentionedParticipants("hey @alice look @", [
        P("1", ""),
        P("2", "alice"),
      ]),
    ).toEqual([P("2", "alice")]);
  });

  it("includes the author when they @-mention themselves (aligned with listen)", () => {
    // The client `listen --mention alice` matcher does not exclude the author,
    // so neither do we — the inbox must equal what a live listen would catch.
    expect(extractMentionedParticipants("note to @alice self", [P("1", "alice")])).toEqual([
      P("1", "alice"),
    ]);
  });

  it("does not match @ preceded by a name char (email-like) so 'user@alice.com' is not an @alice mention", () => {
    // The single-pass scanner skips `@` occurrences whose previous char is a
    // NAME_CHAR, matching the client-side mentionMatches intent.
    expect(extractMentionedParticipants("user@alice.com", [P("1", "alice")])).toEqual([]);
    expect(extractMentionedParticipants("a@alice rest", [P("1", "alice")])).toEqual([]);
    // But when preceded by a non-name char it matches normally.
    expect(extractMentionedParticipants("(check)@alice", [P("1", "alice")])).toEqual([P("1", "alice")]);
  });

  it("recognises CJK, numeric and hyphen/underscore in names (NAME_CHAR class)", () => {
    expect(extractMentionedParticipants("@走查-体验 帮忙", [P("1", "走查-体验")])).toEqual([P("1", "走查-体验")]);
    expect(extractMentionedParticipants("@bob_42 ping", [P("1", "bob_42")])).toEqual([P("1", "bob_42")]);
    expect(extractMentionedParticipants("@张三 看", [P("1", "张三")])).toEqual([P("1", "张三")]);
  });

  it("does not treat a lone trailing @ (no name chars after it) as a mention", () => {
    expect(extractMentionedParticipants("hi @", [P("1", "alice")])).toEqual([]);
    expect(extractMentionedParticipants("hi @ ", [P("1", "alice")])).toEqual([]);
  });

  it("handles @ embedded in a URL path without false-positive mention extraction", () => {
    // The `user@` in email/host parts is suppressed; plain path-style `@foo`
    // (preceded by `/`, a non-name char) still matches a real participant.
    expect(extractMentionedParticipants("see /path/@alice", [P("1", "alice")])).toEqual([P("1", "alice")]);
    expect(extractMentionedParticipants("mail: x@alice", [P("1", "alice")])).toEqual([]);
  });

  it("returns the mentions in text order (first-seen) not roster order", () => {
    const roster = [P("1", "alice"), P("2", "bob"), P("3", "carol")];
    expect(extractMentionedParticipants("@carol then @alice", roster)).toEqual([
      P("3", "carol"),
      P("1", "alice"),
    ]);
  });

  it("rebounds the cache on a different roster (invalidation behaviour)", () => {
    // First call seeds the cache.
    expect(extractMentionedParticipants("@alice", [P("1", "alice")])).toEqual([
      P("1", "alice"),
    ]);
    // Second call with a different roster (same size) must still match the
    // new roster, not the one baked into the cache.
    expect(extractMentionedParticipants("@bob", [P("2", "bob")])).toEqual([
      P("2", "bob"),
    ]);
  });

  it("respects invalidateParticipantNameMap for stale-data recovery", () => {
    expect(extractMentionedParticipants("@alice", [P("1", "alice")])).toEqual([
      P("1", "alice"),
    ]);
    invalidateParticipantNameMap();
    expect(extractMentionedParticipants("@alice", [P("2", "alice")])).toEqual([
      P("2", "alice"),
    ]);
  });
});
