// club mentions 单元测试:格式化 + 核心流程(列未读 → 可选标已读)。
//
// 用注入的假 deps(list / markRead),不起真实 server。

import { describe, expect, it, vi } from "vitest";

import type { Mention } from "@vatwiki/shared";

import { formatMentionLine, runMentions } from "./mentions.js";

function mention(over: Partial<Mention> = {}): Mention {
  return {
    id: "mn_1",
    messageId: "01J00000000000000000000001",
    participantId: "p_me",
    authorId: "p_alice",
    authorName: "alice",
    content: "@bot help me",
    messageCreatedAt: new Date("2024-01-01T09:30:00Z").getTime(),
    readAt: null,
    room: "dev",
    ...over,
  };
}

describe("formatMentionLine", () => {
  it("格式化:时间 作者 房间 正文 + messageId(方便后续 club read --since)", () => {
    const line = formatMentionLine(mention());
    // 时间按本地时区,只断言结构不断言具体时分
    expect(line).toContain("@alice");
    expect(line).toContain("#dev");
    expect(line).toContain("@bot help me");
    expect(line).toContain("msg=01J00000000000000000000001");
  });
});

describe("runMentions", () => {
  it("默认:打印未读并标记已读(cron 去重契约)", async () => {
    const items = [mention({ id: "mn_1" }), mention({ id: "mn_2", authorName: "bob" })];
    const markRead = vi.fn().mockResolvedValue(items);
    const log = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runMentions({}, { list: async () => items, markRead });

    // 打印了两行
    const out = (log.mock.calls.map((c) => String(c[0])).join(""));
    expect(out).toContain("@alice");
    expect(out).toContain("@bob");
    // 标记了两个 mention 已读
    expect(markRead).toHaveBeenCalledWith(["mn_1", "mn_2"]);

    log.mockRestore();
  });

  it("--no-read:只看不标(下次还能看到)", async () => {
    const items = [mention({ id: "mn_1" })];
    const markRead = vi.fn();
    const log = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runMentions({ read: false }, { list: async () => items, markRead });

    expect(markRead).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("无未读时打印提示且不调 markRead", async () => {
    const markRead = vi.fn();
    const log = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runMentions({}, { list: async () => [], markRead });

    const out = (log.mock.calls.map((c) => String(c[0])).join(""));
    expect(out).toContain("(no unread @-mentions)");
    expect(markRead).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("--json:输出 JSON 数组,仍标记已读", async () => {
    const items = [mention({ id: "mn_1" })];
    const markRead = vi.fn().mockResolvedValue(items);
    const log = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runMentions({ json: true }, { list: async () => items, markRead });

    const out = log.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(out.trim());
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("mn_1");
    expect(markRead).toHaveBeenCalledWith(["mn_1"]);
    log.mockRestore();
  });
});
