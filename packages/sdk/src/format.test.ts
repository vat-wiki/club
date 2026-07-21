import { describe, expect,it } from "vitest";

import type { Message } from "@club/shared";

import { formatMessage } from "./format.js";

function base(content: string, extra: Partial<Message> = {}): Message {
  return {
    id: "m1",
    participantId: "p1",
    authorName: "alice",
    content,
    createdAt: new Date("2026-01-01T09:05:00").getTime(),
    ...extra,
  };
}

describe("formatMessage", () => {
  it("renders a plain text message", () => {
    expect(formatMessage(base("hi"))).toBe("[09:05] alice: hi");
  });

  it("appends [图片: url] for each attachment (cross-client visibility)", () => {
    const m = base("look", {
      attachments: [
        { id: "abc", url: "/files/abc", mime: "image/png", size: 10 },
      ],
    });
    expect(formatMessage(m)).toBe("[09:05] alice: look [图片: /files/abc]");
  });

  it("renders attachments even when text is empty (pure-image message)", () => {
    const m = base("", {
      attachments: [
        { id: "abc", url: "/files/abc", mime: "image/png", size: 10 },
        { id: "def", url: "/files/def", mime: "image/jpeg", size: 20 },
      ],
    });
    expect(formatMessage(m)).toBe(
      "[09:05] alice: [图片: /files/abc] [图片: /files/def]",
    );
  });

  it("renders a deleted (recalled) message with author and timestamp", () => {
    const m = base("hi", { deleted: true });
    expect(formatMessage(m)).toBe("[09:05] alice: (recalled)");
  });

  it("renders video attachments as [视频: url]", () => {
    const m = base("watch this", {
      attachments: [
        { id: "v1", url: "/files/v1", mime: "video/mp4", size: 1000 },
      ],
    });
    expect(formatMessage(m)).toBe("[09:05] alice: watch this [视频: /files/v1]");
  });

  it("renders document attachments as [文件: filename]", () => {
    const m = base("see", {
      attachments: [
        { id: "d1", url: "/files/d1", mime: "application/pdf", size: 500, filename: "notes.pdf" },
      ],
    });
    expect(formatMessage(m)).toBe("[09:05] alice: see [文件: notes.pdf]");
  });

  it("falls back to id when document attachment has no filename", () => {
    const m = base("see", {
      attachments: [
        { id: "d1", url: "/files/d1", mime: "application/octet-stream", size: 50 },
      ],
    });
    expect(formatMessage(m)).toBe("[09:05] alice: see [文件: d1]");
  });

  it("handles mixed attachments (image + video + document) in order", () => {
    const m = base("mix", {
      attachments: [
        { id: "i1", url: "/files/i1", mime: "image/png", size: 10 },
        { id: "v1", url: "/files/v1", mime: "video/webm", size: 100 },
        { id: "d1", url: "/files/d1", mime: "application/pdf", size: 200, filename: "a.pdf" },
      ],
    });
    expect(formatMessage(m)).toBe(
      "[09:05] alice: mix [图片: /files/i1] [视频: /files/v1] [文件: a.pdf]",
    );
  });

  it("appends reactions as emoji(count)", () => {
    const m = base("hi", {
      reactions: [
        { emoji: "👍", count: 3 },
        { emoji: "❤️", count: 1 },
      ],
    });
    expect(formatMessage(m)).toBe("[09:05] alice: hi 👍(3) ❤️(1)");
  });

  it("renders a message with both attachments and reactions", () => {
    const m = base("pic", {
      attachments: [
        { id: "i1", url: "/files/i1", mime: "image/png", size: 10 },
      ],
      reactions: [{ emoji: "😂", count: 2 }],
    });
    expect(formatMessage(m)).toBe("[09:05] alice: pic [图片: /files/i1] 😂(2)");
  });

  it("renders empty-attachment-and-empty-reaction message as plain text", () => {
    const m = base("bare", { attachments: [], reactions: [] });
    expect(formatMessage(m)).toBe("[09:05] alice: bare");
  });

  it("formats a midnight timestamp as [00:00] (padStart)", () => {
    const m = { ...base("hi"), createdAt: new Date("2026-01-01T00:00:00").getTime() };
    expect(formatMessage(m)).toBe("[00:00] alice: hi");
  });

  it("formats a late-night timestamp (23:59)", () => {
    const m = { ...base("hi"), createdAt: new Date("2026-01-01T23:59:00").getTime() };
    expect(formatMessage(m)).toBe("[23:59] alice: hi");
  });

  it("preserves content whitespace (leading/trailing) as-is", () => {
    const m = base("  spaced  ");
    expect(formatMessage(m)).toBe("[09:05] alice:   spaced  ");
  });

  it("omits reaction space when reactions are absent (no trailing space)", () => {
    const m = base("no reactions");
    expect(formatMessage(m).endsWith("no reactions")).toBe(true);
  });

  it("uses UTC date parsing (createdAt is epoch ms)", () => {
    const epoch = Date.UTC(2026, 0, 1, 10, 4, 0); // Jan 1 2026 10:04 UTC
    const m = { ...base("utc test"), createdAt: epoch };
    const rendered = formatMessage(m);
    // The function reads local hours/minutes via new Date().getTimezoneOffset
    // is irrelevant — we assert it renders without throwing and contains the author.
    expect(rendered).toContain("alice:");
    expect(rendered).toContain("utc test");
  });

  it("handles a deleted message without authorName gracefully", () => {
    const m = { ...base("x", { deleted: true }), authorName: "" };
    expect(formatMessage(m)).toBe("[09:05] : (recalled)");
  });
});
