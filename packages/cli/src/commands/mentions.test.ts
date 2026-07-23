import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClubApiError } from "@club/sdk";
import type { Mention } from "@club/shared";

import { formatMention, type MentionDeps, mentionToMessage, runMentions } from "./mentions.js";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeMention(
  overrides: Partial<Mention> = {},
): Mention {
  return {
    id: "m1",
    messageId: "msg1",
    authorId: "p1",
    authorName: "alice",
    content: "@bob hi",
    messageCreatedAt: 1719700000000,
    room: "general",
    readAt: null,
    ...overrides,
  };
}

function makeDeps(
  over: Partial<MentionDeps> = {},
): MentionDeps {
  return {
    mentions: vi.fn().mockResolvedValue([]),
    markMentionsRead: vi.fn().mockResolvedValue([]),
    markMentionRead: vi.fn().mockResolvedValue(makeMention()),
    push: vi.fn().mockResolvedValue(true),
    ...over,
  };
}

describe("formatMention", () => {
  it("renders a mention as a formatted message", () => {
    const m = makeMention({ content: "@bob go check this" });
    const line = formatMention(m);
    expect(line).toContain("alice");
    expect(line).toContain("@bob go check this");
  });

  it("uses the mention's messageCreatedAt as the message timestamp", () => {
    const ts = 1719700000000;
    const line = formatMention(makeMention({ messageCreatedAt: ts }));
    expect(line).toMatch(/\d{2}:\d{2}/);
  });
});

describe("mentionToMessage", () => {
  it("maps a Mention to a Message with matching fields", () => {
    const m = makeMention({
      messageId: "msg9",
      authorId: "p9",
      authorName: "carol",
      content: "@bob look",
      messageCreatedAt: 1719700099999,
      room: "dev",
    });
    const out = mentionToMessage(m);
    expect(out).toMatchObject({
      id: "msg9",
      participantId: "p9",
      authorName: "carol",
      content: "@bob look",
      createdAt: 1719700099999,
      room: "dev",
    });
  });
});

describe("runMentions", () => {
  it("is a silent no-op when there are no unread mentions", async () => {
    const deps = makeDeps();
    await runMentions({}, deps);
    expect(deps.push).not.toHaveBeenCalled();
    expect(deps.markMentionsRead).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it("marks all mentions read in a single batch call", async () => {
    const m1 = makeMention({ id: "m1", content: "@bob hi" });
    const m2 = makeMention({ id: "m2", content: "@bob please" });
    const deps = makeDeps({
      mentions: vi.fn().mockResolvedValue([m1, m2]),
      markMentionsRead: vi.fn().mockResolvedValue([m1, m2]),
    });
    await runMentions({}, deps);
    expect(deps.push).toHaveBeenCalledTimes(2);
    expect(deps.push).toHaveBeenNthCalledWith(1, mentionToMessage(m1));
    expect(deps.push).toHaveBeenNthCalledWith(2, mentionToMessage(m2));
    expect(deps.markMentionsRead).toHaveBeenCalledTimes(1);
    expect(deps.markMentionsRead).toHaveBeenCalledWith(["m1", "m2"]);
    expect(deps.markMentionRead).not.toHaveBeenCalled(); // batch succeeded
  });

  it("marks all mentions read even though --read is now always-on", async () => {
    // The legacy --read flag is accepted for back-compat but no longer gates
    // marking: every run marks read, because forwarding without marking would
    // re-fire on every poll.
    const m1 = makeMention({ id: "m1" });
    const deps = makeDeps({
      mentions: vi.fn().mockResolvedValue([m1]),
      markMentionsRead: vi.fn().mockResolvedValue([m1]),
    });
    await runMentions({ read: false }, deps);
    expect(deps.markMentionsRead).toHaveBeenCalledWith(["m1"]);
  });

  it("falls back to per-id markRead when batch endpoint 404s (older server)", async () => {
    const m1 = makeMention({ id: "m1" });
    const m2 = makeMention({ id: "m2" });
    const deps = makeDeps({
      mentions: vi.fn().mockResolvedValue([m1, m2]),
      markMentionsRead: vi.fn().mockRejectedValue(new ClubApiError("not found", 404)),
      markMentionRead: vi.fn().mockResolvedValue(m1),
    });
    await runMentions({}, deps);
    expect(deps.markMentionsRead).toHaveBeenCalledTimes(1);
    expect(deps.markMentionRead).toHaveBeenCalledTimes(2);
    expect(deps.markMentionRead).toHaveBeenCalledWith("m1");
    expect(deps.markMentionRead).toHaveBeenCalledWith("m2");
  });

  it("swallows a per-id 409 (already read) during the fallback loop", async () => {
    const m1 = makeMention({ id: "m1" });
    const deps = makeDeps({
      mentions: vi.fn().mockResolvedValue([m1]),
      markMentionsRead: vi.fn().mockRejectedValue(new ClubApiError("not found", 404)),
      markMentionRead: vi.fn().mockRejectedValue(new ClubApiError("already read", 409)),
    });
    await expect(runMentions({}, deps)).resolves.toBeUndefined();
  });

  it("re-throws a non-404/non-409 batch error", async () => {
    const m1 = makeMention({ id: "m1" });
    const deps = makeDeps({
      mentions: vi.fn().mockResolvedValue([m1]),
      markMentionsRead: vi.fn().mockRejectedValue(new ClubApiError("timeout", 504)),
    });
    await expect(runMentions({}, deps)).rejects.toThrow("timeout");
  });

  it("re-throws a non-409/non-404 per-id error during fallback", async () => {
    const m1 = makeMention({ id: "m1" });
    const deps = makeDeps({
      mentions: vi.fn().mockResolvedValue([m1]),
      markMentionsRead: vi.fn().mockRejectedValue(new ClubApiError("not found", 404)),
      markMentionRead: vi.fn().mockRejectedValue(new ClubApiError("server error", 500)),
    });
    await expect(runMentions({}, deps)).rejects.toThrow("server error");
  });

  it("marks read only the ids whose push succeeded (data-loss guard)", async () => {
    // m1 push fails (daemon down), m2 push succeeds: only m2 must be marked
    // read. m1 stays unread on the server so the next poll re-attempts it —
    // never silently drop a message by marking-read what wasn't delivered.
    const m1 = makeMention({ id: "m1" });
    const m2 = makeMention({ id: "m2" });
    const deps = makeDeps({
      mentions: vi.fn().mockResolvedValue([m1, m2]),
      push: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
      markMentionsRead: vi.fn().mockResolvedValue([m2]),
    });
    await runMentions({}, deps);
    expect(deps.push).toHaveBeenCalledTimes(2);
    expect(deps.markMentionsRead).toHaveBeenCalledWith(["m2"]);
  });

  it("marks nothing read when every push fails (retry next poll)", async () => {
    const m1 = makeMention({ id: "m1" });
    const m2 = makeMention({ id: "m2" });
    const deps = makeDeps({
      mentions: vi.fn().mockResolvedValue([m1, m2]),
      push: vi.fn().mockResolvedValue(false),
      markMentionsRead: vi.fn().mockResolvedValue([]),
    });
    await runMentions({}, deps);
    expect(deps.markMentionsRead).not.toHaveBeenCalled();
  });

  it("swallows a batch 409 from markMentionsRead (concurrent poll already marked)", async () => {
    const m1 = makeMention({ id: "m1" });
    const deps = makeDeps({
      mentions: vi.fn().mockResolvedValue([m1]),
      markMentionsRead: vi.fn().mockRejectedValue(new ClubApiError("conflict", 409)),
    });
    await expect(runMentions({}, deps)).resolves.toBeUndefined();
    // 409 on batch must NOT trigger the per-id fallback.
    expect(deps.markMentionRead).not.toHaveBeenCalled();
  });

  it("re-throws a non-409 batch error during markMentionsRead", async () => {
    const m1 = makeMention({ id: "m1" });
    const deps = makeDeps({
      mentions: vi.fn().mockResolvedValue([m1]),
      markMentionsRead: vi.fn().mockRejectedValue(new ClubApiError("timeout", 504)),
    });
    await expect(runMentions({}, deps)).rejects.toThrow("timeout");
  });
});
