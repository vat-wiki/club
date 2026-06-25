import { describe, it, expect } from "vitest";
import { extractMentionedParticipants } from "./mention.js";

const P = (id: string, name: string) => ({ id, name });

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

  it("is substring-based, intentionally (mirrors the client rule)", () => {
    // Pinned: the client matcher is a substring match on "@<name>", so a short
    // name matches a longer token. This is a known trade-off (simplicity over
    // precision); changing it MUST be done in lockstep with cli/mcp.
    expect(extractMentionedParticipants("ping @alicia", [P("1", "al")])).toEqual([
      P("1", "al"),
    ]);
    expect(extractMentionedParticipants("see @editorial", [P("1", "ed")])).toEqual([
      P("1", "ed"),
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
});
