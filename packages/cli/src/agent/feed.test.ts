// feed 单元测试:消息格式化 + 投递过滤逻辑。
//
// 这些是纯函数(不依赖网络/PTY),用构造的消息对象直接断言。
// stream 接线本身由 SDK 的 stream.test.ts 覆盖,这里只测"消息来了怎么处理"。

import { describe, expect, it } from "vitest";

import type { Message } from "@club/shared";

import { formatForInject, shouldDeliver } from "../agent/feed.js";

/** 构造一条最小可用的 Message。 */
function msg(over: Partial<Message> = {}): Message {
  return {
    id: "01J00000000000000000000001",
    participantId: "p_alice",
    authorName: "alice",
    content: "hello",
    createdAt: 1_700_000_000_000,
    room: "general",
    ...over,
  };
}

describe("formatForInject", () => {
  it("格式化为单行:emoji + [@room] author: body", () => {
    const m = msg({ content: "你好", room: "dev", authorName: "rex" });
    expect(formatForInject(m, false)).toBe("🔵[@dev] rex: 你好");
  });

  it("被 @ 的消息用 🟡(warning),否则 🔵(info)", () => {
    const m = msg({ content: "@bot 看下日志", authorName: "rex", room: "dev" });
    expect(formatForInject(m, true)).toBe("🟡[@dev] rex: @bot 看下日志");
    expect(formatForInject(m, false)).toBe("🔵[@dev] rex: @bot 看下日志");
  });

  it("把换行/制表符压成单行(否则 TUI 输入框会进多行模式,回车不再提交)", () => {
    const m = msg({
      content: "第一行\n第二行\t有缩进\r\n第三行",
      authorName: "a",
      room: "r",
    });
    const out = formatForInject(m, false);
    expect(out).not.toMatch(/\r|\n|\t/);
    expect(out.startsWith("🔵[@r] a: 第一行 ")).toBe(true);
  });

  it("超长内容截断并标记(避免灌爆 TUI 输入框)", () => {
    const long = "x".repeat(1000);
    const out = formatForInject(msg({ content: long }), false);
    expect(out.endsWith("…(已截断)")).toBe(true);
    expect(out.length).toBeLessThan(long.length);
  });

  it("空内容也给出可识别的标题(不崩)", () => {
    const out = formatForInject(msg({ content: "   " }), false);
    expect(out).toBe("🔵[@general] alice:");
  });
});

describe("shouldDeliver", () => {
  it("默认投递所有消息", () => {
    expect(shouldDeliver(msg())).toBe(true);
  });

  it("跳过自己发的消息(避免回声:agent 每发一条就被自己触发)", () => {
    const mine = msg({ participantId: "p_me" });
    expect(shouldDeliver(mine, { meId: "p_me" })).toBe(false);
    expect(shouldDeliver(mine, { meId: "p_other" })).toBe(true);
    // meId 未知时不做自回声过滤(安全降级)
    expect(shouldDeliver(mine, {})).toBe(true);
  });

  it("设了 mention 时只投递 @该名字 的消息", () => {
    const mentioned = msg({ content: "hey @bot please help" });
    const ambient = msg({ content: "just chatting" });
    expect(shouldDeliver(mentioned, { mention: "bot" })).toBe(true);
    expect(shouldDeliver(ambient, { mention: "bot" })).toBe(false);
  });

  it("mention 匹配边界:@botx 不算 @bot", () => {
    expect(shouldDeliver(msg({ content: "@botx hi" }), { mention: "bot" })).toBe(false);
    expect(shouldDeliver(msg({ content: "@bot hi" }), { mention: "bot" })).toBe(true);
  });

  it("自回声 + mention 两个过滤都满足才投递", () => {
    const mine = msg({ participantId: "p_me", content: "@bot hi" });
    // 自己发的 @自己 → 被自回声过滤拦掉
    expect(shouldDeliver(mine, { meId: "p_me", mention: "bot" })).toBe(false);
    const others = msg({ participantId: "p_other", content: "@bot hi" });
    expect(shouldDeliver(others, { meId: "p_me", mention: "bot" })).toBe(true);
  });
});
