// QueuedInjector 单元测试:验证"忙就不注入,闲了才注入"的核心契约。
//
// 直接从 notify-panel/extensions/tui/test/queue.test.ts 移植 —— 逻辑一模一样,
// 只改了 import 路径。用 vitest 假时钟精确控制时间(idle 判据是静默期)。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  QueuedInjector,
  IDLE_QUIET_MS,
  POST_INJECT_COOLDOWN_MS,
} from "../agent/queue.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("QueuedInjector", () => {
  it("入队后,持续输出期间不注入(忙时不注入)", () => {
    const inject = vi.fn().mockReturnValue(true);
    const qi = new QueuedInjector(inject);

    // 模拟目标持续输出(忙):每隔一段就 observeOutput,保持 busy
    qi.enqueue("通知A");
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(800);
      qi.observeOutput(); // 还在忙
    }
    expect(inject).not.toHaveBeenCalled();
    expect(qi.queueDepth).toBe(1);
  });

  it("静默满 IDLE_QUIET_MS 后注入队首一条", () => {
    const inject = vi.fn().mockReturnValue(true);
    const qi = new QueuedInjector(inject);

    qi.enqueue("通知A");
    qi.enqueue("通知B");
    // 初始就是 idle(没 observeOutput 过),enqueue 会 arm timer
    // 推进超过 IDLE_QUIET_MS → 应注入一条
    vi.advanceTimersByTime(IDLE_QUIET_MS + 10);
    expect(inject).toHaveBeenCalledTimes(1);
    expect(inject).toHaveBeenCalledWith("通知A");
    expect(qi.queueDepth).toBe(1); // 还剩 B
  });

  it("注入后进入冷却 busy,冷却内不注入第二条", () => {
    const inject = vi.fn().mockReturnValue(true);
    const qi = new QueuedInjector(inject);

    qi.enqueue("A");
    qi.enqueue("B");
    // 注入 A(初始 idle,静默期满)
    vi.advanceTimersByTime(IDLE_QUIET_MS + 10);
    expect(inject).toHaveBeenCalledTimes(1);
    expect(inject).toHaveBeenCalledWith("A");

    // 冷却期中还差很多 → B 不该注入
    vi.advanceTimersByTime(POST_INJECT_COOLDOWN_MS - 500);
    expect(inject).toHaveBeenCalledTimes(1);

    // 冷却结束 → B 注入
    vi.advanceTimersByTime(600);
    expect(inject).toHaveBeenCalledTimes(2);
    expect(inject).toHaveBeenNthCalledWith(2, "B");
    expect(qi.queueDepth).toBe(0);
  });

  it("注入失败时把消息放回队头,不丢", () => {
    const inject = vi.fn().mockReturnValue(false); // 永远失败
    const qi = new QueuedInjector(inject);

    qi.enqueue("A");
    vi.advanceTimersByTime(IDLE_QUIET_MS + 10);
    // 注入失败 → A 还在队列里
    expect(qi.queueDepth).toBe(1);
  });

  it("输出活动会推迟注入(直到再次静默)", () => {
    const inject = vi.fn().mockReturnValue(true);
    const qi = new QueuedInjector(inject);

    qi.enqueue("A");
    // 在静默期内多次输出 → 持续保持 busy,不注入
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(IDLE_QUIET_MS - 100);
      qi.observeOutput();
    }
    expect(inject).not.toHaveBeenCalled();

    // 现在彻底静默 → 注入
    vi.advanceTimersByTime(IDLE_QUIET_MS + 10);
    expect(inject).toHaveBeenCalledTimes(1);
  });

  it("状态变化时回调(供 UI 展示 busy/idle)", () => {
    const changes: Array<{ state: string; depth: number }> = [];
    const inject = vi.fn().mockReturnValue(true);
    const qi = new QueuedInjector(inject, (state, depth) =>
      changes.push({ state, depth }),
    );

    qi.observeOutput(); // idle → busy
    qi.enqueue("A");
    vi.advanceTimersByTime(IDLE_QUIET_MS + 10); // 注入 → busy(冷却)
    // 预期变化序列:idle→busy(有输出),busy→idle(静默),idle→busy(注入冷却)
    const states = changes.map((c) => c.state);
    expect(states[0]).toBe("busy");
    expect(states).toContain("idle");
    expect(states[states.length - 1]).toBe("busy");
  });
});
