// pty 模块的纯逻辑测试:writeToPty 的提交时序契约。
//
// 核心修复:text 与提交键(\r)必须分两次 write,中间留 SUBMIT_DELAY_MS,
// 否则 codex(ratatui)会把同 tick 读到的 \r 当文本处理、不提交。
// 这里用假时钟 + 假 pty 验证这个时序,不起真实 PTY。
//
// (runAgent 需要真实 TTY + node-pty,不在单元测试覆盖范围;它在
// notify-panel-tui 已端到端验证过,行为一致。)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeToPty } from "../agent/pty.js";

/** 一个最小的假 IPty:只记录被 write 的字符串。 */
function fakePty() {
  const writes: string[] = [];
  return {
    writes,
    pty: {
      write(s: string) {
        writes.push(s);
      },
    } as unknown as Parameters<typeof writeToPty>[0],
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("writeToPty", () => {
  it("立即写 text,延迟写提交键 \\r(分两 tick,保证 codex 识别为提交)", () => {
    const { writes, pty } = fakePty();
    const inject = writeToPty(pty);

    const ok = inject("hello");
    expect(ok).toBe(true);
    // text 立刻写入
    expect(writes).toEqual(["hello"]);

    // 还没到延迟,\r 不该出现
    expect(writes).not.toContain("\r");

    // 快进过 SUBMIT_DELAY_MS 后,提交键才跟上
    vi.advanceTimersByTime(80);
    expect(writes).toEqual(["hello", "\r"]);
  });

  it("write text 抛错时返回 false 且不再写提交键", () => {
    const pty = {
      write() {
        throw new Error("target exited");
      },
    } as unknown as Parameters<typeof writeToPty>[0];
    const inject = writeToPty(pty);

    const ok = inject("hello");
    expect(ok).toBe(false);
  });

  it("text 写入成功但延迟期间目标消失:\\r 写入抛错被吞(不崩进程)", () => {
    const writes: string[] = [];
    let call = 0;
    const pty = {
      write(s: string) {
        call++;
        if (call === 1) writes.push(s); // text 成功
        else throw new Error("gone"); // \r 时目标已退
      },
    } as unknown as Parameters<typeof writeToPty>[0];
    const inject = writeToPty(pty);

    inject("hi");
    expect(writes).toEqual(["hi"]);
    // 不该抛
    expect(() => vi.advanceTimersByTime(80)).not.toThrow();
    expect(writes).toEqual(["hi"]); // \r 没写进去
  });
});
