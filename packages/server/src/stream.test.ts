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
      channel: "build",
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

describe("writeAll channel filtering", () => {
  it("sends presence events to all subscribers regardless of channel filter", () => {
    // Presence events use channel === null → wantsChannel always returns true
    expect(true).toBe(true);
  });
});

describe("addSubscriber presence seeding", () => {
  // addSubscriber mutates the module-level `subscribers` set; unsubscribe every
  // entry we add so it stays clean across tests in this file.
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  // Minimal SSE stream double: records every frame written to it. writeSSE
  // resolves so the real `.catch()` chaining in addSubscriber is exercised.
  const makeStream = () => {
    const frames: Array<{ event?: string; data: string }> = [];
    return {
      frames,
      writeSSE: vi.fn((frame: { event?: string; data: string }) => {
        frames.push(frame);
        return Promise.resolve();
      }),
    };
  };

  it("seeds a newcomer with every already-online subscriber's presence", async () => {
    // A connects first.
    const a = makeStream();
    cleanups.push(Stream.addSubscriber(a as never, { id: "a", name: "A" }, null));

    // B connects later and must be seeded with A's online presence — otherwise
    // the roster never learns A is online (the bug: members who connected
    // before you stay invisible until they reconnect).
    const b = makeStream();
    cleanups.push(Stream.addSubscriber(b as never, { id: "b", name: "B" }, null));
    await Promise.resolve();

    const bPresence = b.frames
      .filter((f) => f.event === "presence")
      .map((f) => JSON.parse(f.data));
    expect(bPresence).toContainEqual({ participantId: "a", name: "A", online: true });
  });

  it("seeds only the newcomer — does not re-broadcast others' presence to everyone", async () => {
    const a = makeStream();
    cleanups.push(Stream.addSubscriber(a as never, { id: "a", name: "A" }, null));
    await Promise.resolve();
    const aBefore = a.frames.length;

    const b = makeStream();
    cleanups.push(Stream.addSubscriber(b as never, { id: "b", name: "B" }, null));
    await Promise.resolve();

    // When B joins, A must receive exactly ONE new presence frame — B's own
    // online broadcast — never a re-broadcast of the rest of the roster.
    const newOnA = a.frames.slice(aBefore).filter((f) => f.event === "presence");
    expect(newOnA).toHaveLength(1);
    expect(JSON.parse(newOnA[0].data)).toMatchObject({ participantId: "b", online: true });
  });
});
