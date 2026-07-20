import { afterEach,beforeEach, describe, expect, it, vi } from "vitest";

import { ClubApiError } from "@club/sdk";
import type { Mention } from "@club/shared";

import { formatMention, type MentionDeps,runMentions } from "./mentions.js";

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
    room: { id: "r1", slug: "general" },
    read: false,
    ...overrides,
  };
}

function makeDeps(
  over: Partial<MentionDeps> = {},
): MentionDeps {
  return {
    mentions: vi.fn().mockResolvedValue([]),
    markMentionsRead: vi.fn().mockResolvedValue([]),
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

describe("runMentions", () => {
  it("prints '(no unread mentions)' when the list is empty", async () => {
    const deps = makeDeps();
    await runMentions({}, deps);
    expect(console.log).toHaveBeenCalledWith("(no unread mentions)");
    expect(deps.markMentionsRead).not.toHaveBeenCalled();
  });

  it("prints each mention line when there are results", async () => {
    const m1 = makeMention({ id: "m1", content: "@bob hi" });
    const m2 = makeMention({ id: "m2", content: "@bob please" });
    const deps = makeDeps({
      mentions: vi.fn().mockResolvedValue([m1, m2]),
    });
    await runMentions({}, deps);
    expect(console.log).toHaveBeenCalledTimes(2);
    expect(deps.markMentionsRead).not.toHaveBeenCalled();
  });

  it("marks all mentions read in a single batch call when --read is set", async () => {
    const m1 = makeMention({ id: "m1" });
    const m2 = makeMention({ id: "m2" });
    const deps = makeDeps({
      mentions: vi.fn().mockResolvedValue([m1, m2]),
      markMentionsRead: vi.fn().mockResolvedValue([m1, m2]),
    });
    await runMentions({ read: true }, deps);
    expect(deps.markMentionsRead).toHaveBeenCalledTimes(1);
    expect(deps.markMentionsRead).toHaveBeenCalledWith(["m1", "m2"]);
    expect(console.log).toHaveBeenCalledWith("(marked 2 read)");
  });

  it("re-throws a non-409 error during --read batch", async () => {
    const m1 = makeMention({ id: "m1" });
    const deps = makeDeps({
      mentions: vi.fn().mockResolvedValue([m1]),
      markMentionsRead: vi.fn().mockRejectedValue(new ClubApiError("timeout", 504)),
    });
    await expect(runMentions({ read: true }, deps)).rejects.toThrow("timeout");
  });
});
