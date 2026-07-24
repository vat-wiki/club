import { describe, expect, it } from "vitest";

import type { Message } from "@club/shared";

import { shouldForwardMessage } from "./listen.js";

function makeMessage(over: Partial<Message> = {}): Message {
  return {
    id: "m1",
    participantId: "p1",
    authorName: "alice",
    content: "hello world",
    createdAt: 1719700000000,
    room: "general",
    ...over,
  };
}

describe("shouldForwardMessage", () => {
  describe("self-skip", () => {
    it("forwards a message from someone else", () => {
      const m = makeMessage({ participantId: "p_other" });
      expect(shouldForwardMessage(m, { meId: "p_me" })).toBe(true);
    });

    it("skips a message authored by us (no echo of our own sends)", () => {
      // Regression: before self-skip, every `club send` echoed back into the
      // inbox as an incoming `info` notification.
      const m = makeMessage({ participantId: "p_me", authorName: "王运维" });
      expect(shouldForwardMessage(m, { meId: "p_me" })).toBe(false);
    });

    it("forwards our own message when meId is unknown (never drop a message)", () => {
      // GET /me failed → meId undefined → self-skip disabled. Echoing is minor
      // noise; dropping a real incoming message is data loss.
      const m = makeMessage({ participantId: "p_me" });
      expect(shouldForwardMessage(m, {})).toBe(true);
      expect(shouldForwardMessage(m, { meId: undefined })).toBe(true);
    });

    it("does not treat same-name-but-different-id as self", () => {
      // Two participants may share a display name; identity is the id.
      const m = makeMessage({ participantId: "p_other", authorName: "王运维" });
      expect(shouldForwardMessage(m, { meId: "p_me" })).toBe(true);
    });
  });

  describe("mention filter", () => {
    it("forwards a message that mentions the target", () => {
      const m = makeMessage({ content: "@王运维 please check this" });
      expect(shouldForwardMessage(m, { mention: "王运维" })).toBe(true);
    });

    it("skips a message that does not mention the target", () => {
      const m = makeMessage({ content: "anyone around?" });
      expect(shouldForwardMessage(m, { mention: "王运维" })).toBe(false);
    });
  });

  describe("combined", () => {
    it("skips our own message even if it mentions the target", () => {
      // self-skip runs before the mention filter (short-circuit)
      const m = makeMessage({
        participantId: "p_me",
        content: "@王运维 noting this for myself",
      });
      expect(shouldForwardMessage(m, { meId: "p_me", mention: "王运维" })).toBe(
        false,
      );
    });

    it("forwards a third party's message that mentions the target", () => {
      const m = makeMessage({
        participantId: "p_other",
        content: "@王运维 question for you",
      });
      expect(shouldForwardMessage(m, { meId: "p_me", mention: "王运维" })).toBe(
        true,
      );
    });
  });
});
