import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClubClient } from "@club/sdk";
import type { Message } from "@club/shared";
import { startFeed } from "./feed.js";
import { QueuedInjector, IDLE_QUIET_MS } from "./queue.js";

describe("integration: feed -> queue -> inject", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("真实模块串联:自回声被过滤、带换行消息格式化为单行、idle 后注入", () => {
    let handler: ((m: Message) => void) | null = null;
    const fakeClient = {
      stream(h: (m: Message) => void) { handler = h; return { stop: () => { handler = null; } }; },
    } as unknown as ClubClient;

    const injected: string[] = [];
    const qi = new QueuedInjector((t: string) => { injected.push(t); return true; });
    const stop = startFeed(fakeClient, { inject: { enqueue: (t) => qi.enqueue(t) }, meId: "p_me" });

    handler!({ id: "m1", participantId: "p_me", authorName: "me", content: "我自己", createdAt: 0, room: "dev" } as Message);
    handler!({ id: "m2", participantId: "p_a", authorName: "alice", content: "帮我\n看下\t日志", createdAt: 0, room: "dev" } as Message);

    vi.advanceTimersByTime(IDLE_QUIET_MS + 10);

    expect(injected).toHaveLength(1);
    expect(injected[0]).toBe("🔵[@dev] alice: 帮我 看下 日志");
    expect(/[\r\n\t]/.test(injected[0])).toBe(false);
    stop();
  });

  it("feed stop() 真的断开:停之后再触发 handler 不再入队", () => {
    let handler: ((m: Message) => void) | null = null;
    const fakeClient = {
      stream(h: (m: Message) => void) { handler = h; return { stop: () => { handler = null; } }; },
    } as unknown as ClubClient;
    let enqueued = 0;
    const stop = startFeed(fakeClient, { inject: { enqueue: () => { enqueued++; } }, meId: "p_me" });
    stop();
    handler?.({ id: "m1", participantId: "p_a", authorName: "a", content: "x", createdAt: 0, room: "r" } as Message);
    vi.advanceTimersByTime(IDLE_QUIET_MS + 10);
    expect(enqueued).toBe(0);
  });
});
