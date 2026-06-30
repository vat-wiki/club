import { describe, it, expect } from "vitest";
import { formatMessage } from "./format.js";
import type { Message } from "@club/shared";

function base(content: string, extra: Partial<Message> = {}): Message {
  return {
    id: "m1",
    participantId: "p1",
    authorName: "alice",
    authorKind: "human",
    content,
    createdAt: new Date("2026-01-01T09:05:00").getTime(),
    ...extra,
  };
}

describe("formatMessage", () => {
  it("renders a plain text message", () => {
    expect(formatMessage(base("hi"))).toBe("[09:05] 🧑alice: hi");
  });

  it("appends [图片: url] for each attachment (cross-client visibility)", () => {
    const m = base("look", {
      attachments: [
        { id: "abc", url: "/files/abc", mime: "image/png", size: 10 },
      ],
    });
    expect(formatMessage(m)).toBe("[09:05] 🧑alice: look [图片: /files/abc]");
  });

  it("renders attachments even when text is empty (pure-image message)", () => {
    const m = base("", {
      attachments: [
        { id: "abc", url: "/files/abc", mime: "image/png", size: 10 },
        { id: "def", url: "/files/def", mime: "image/jpeg", size: 20 },
      ],
    });
    expect(formatMessage(m)).toBe(
      "[09:05] 🧑alice: [图片: /files/abc] [图片: /files/def]",
    );
  });
});
