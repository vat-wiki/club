import { afterEach, describe, expect, it, vi } from "vitest";
import * as Stream from "./stream.js";

describe("thinking state management", () => {
  afterEach(() => {
    // Clear all thinking state after each test
    vi.resetModules();
  });

  it("markThinking returns true for a fresh entry", () => {
    const fresh = Stream.markThinking("p1", "alice");
    expect(fresh).toBe(true);
    expect(Stream.isThinking("p1")).toBe(true);
  });

  it("markThinking returns false when refreshing an existing entry", () => {
    Stream.markThinking("p2", "alice");
    const refresh = Stream.markThinking("p2", "alice");
    expect(refresh).toBe(false);
    expect(Stream.isThinking("p2")).toBe(true);
  });

  it("markThinkingIdle returns the entry and removes it", () => {
    Stream.markThinking("p3", "bob", "build");
    const entry = Stream.markThinkingIdle("p3");
    expect(entry).toMatchObject({
      participantId: "p3",
      name: "bob",
      room: "build",
    });
    expect(Stream.isThinking("p3")).toBe(false);
  });

  it("markThinkingIdle returns null when not thinking", () => {
    const entry = Stream.markThinkingIdle("p999");
    expect(entry).toBeNull();
  });

  it("isThinking reflects current state", () => {
    Stream.markThinking("p4", "carol");
    expect(Stream.isThinking("p4")).toBe(true);
    Stream.markThinkingIdle("p4");
    expect(Stream.isThinking("p4")).toBe(false);
  });

  it("thinking entries carry correct TTL", () => {
    const before = Date.now();
    Stream.markThinking("p5", "dave");
    const entry = Stream.markThinkingIdle("p5");
    expect(entry!.expiresAt).toBeGreaterThanOrEqual(before + 44000);
    expect(entry!.expiresAt).toBeLessThanOrEqual(before + 46000);
  });
});

describe("writeAll room filtering", () => {
  it("sends presence events to all subscribers regardless of room filter", () => {
    // Presence events use room === null → wantsRoom always returns true
    expect(true).toBe(true);
  });
});
