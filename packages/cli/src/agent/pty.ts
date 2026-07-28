// PTY 桥接核心 —— `club agent` 的"把 TUI agent 起在伪终端里"的实现。
//
// 本文件从 notify-panel/extensions/tui/src/pty.ts 移植并精简:
//   1. 真实键盘 ──透传──▶ 目标 TUI(用户照常操作,无感)
//   2. 目标 TUI 输出 ──透传──▶ 用户屏幕 + 旁路一份给 QueuedInjector 做 idle 推断
//   3. club SSE 实时消息 ──▶ 单行化 ──▶ 当作"用户敲的字"注入
//
// 去掉了原版的 notify-panel 控制套接字(ctl inject/list)和轮询 daemon 的
// watcher —— 数据源改成 club stream(startFeed)。保留了两个不可省的底层
// 修复:raw mode 修复 + 提交键时序(见各自注释),它们对 claude/codex 等
// TUI agent 是注入能否生效的关键。

import { execSync } from "node:child_process";

import * as pty from "node-pty";

import { type InjectFn,QueuedInjector } from "./queue.js";

/** 起目标进程的参数。 */
export interface SpawnOptions {
  /** 要执行的目标,如 "claude"。 */
  cmd: string;
  /** 透传给目标的参数。 */
  args: string[];
  /** 工作目录,默认当前目录。 */
  cwd?: string;
}

/**
 * 把一段文本注入给目标 TUI(打字 + 提交键)。
 *
 * 关键时序陷阱(实测发现):
 *   node-pty 把数据高速灌进 PTY kernel buffer,codex(ratatui)在同一个
 *   事件循环 tick 里一次性读到完整 "text\r" 会把 \r 当文本处理、不提交。
 *   必须让目标先消化 text、完成回显,再发的提交键才被识别为键事件。
 *   解决:text 与提交键分两次 write,中间用 setTimeout 留出 SUBMIT_DELAY_MS
 *   让目标跑一轮事件循环。
 *
 *   对照:用 Python 的 os.write(fd, b"hi\r") 不需要这个延迟(Python 的
 *   write 路径节奏不同),claude code 的 TUI 也不需要(它的输入处理对
 *   同 tick 的 \r 宽容)。这个延迟对 claude 无副作用,对 codex 必须。
 *
 * @returns text 是否成功写入(提交键异步跟上)
 */
const SUBMIT_DELAY_MS = 80;
export function writeToPty(child: pty.IPty): InjectFn {
  return (text: string): boolean => {
    try {
      child.write(text);
      setTimeout(() => {
        try {
          child.write("\r");
        } catch {
          /* 目标可能已退出 */
        }
      }, SUBMIT_DELAY_MS);
      return true;
    } catch {
      return false;
    }
  };
}

/**
 * 注入回调类型:每次成功注入一条消息时触发(上层用于打日志)。
 */
export type OnInjected = (text: string) => void;

/**
 * 把一个 club feed(实时消息源)接到一个 PTY 目标上运行。
 *
 * 流程:起目标 → raw mode → 接键盘/输出/resize → 起 feed → 等 exit → 清理。
 * club stream 的消息经 formatForInject 单行化后入队 QueuedInjector,在目标
 * idle 时注入。**全程不经过 notify-panel。**
 *
 * @param spawn  目标进程参数(cmd/args/cwd)。
 * @param startFeed  数据源工厂:传入 {enqueue} 返回 stop 句柄。
 *                   用工厂形式是为了让本函数与具体的 club client 解耦,
 *                   同时让测试可以注入假 feed。
 * @param onInjected 可选:每次注入成功时回调(stderr 日志)。
 * @param onStatus   可选:feed/状态变化时回调(stderr 日志)。
 * @returns 目标进程的退出码。
 */
export async function runAgent(
  spawn: SpawnOptions,
  feedFactory: (inject: { enqueue: (t: string) => void }) => () => void,
  onInjected?: OnInjected,
): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("club agent 必须在终端(TTY)下运行");
  }

  // ── 起目标进程 ──
  const child = pty.spawn(spawn.cmd, spawn.args, {
    name: "xterm-256color",
    cwd: spawn.cwd ?? process.cwd(),
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
    env: process.env as Record<string, string>,
  });

  // raw mode 修复(见 applyRawMode 注释):必须在接键盘前从 parent 侧设好,
  // 否则 claude/codex 启动时的 TCSETSW 会卡住,注入的输入没人读。
  applyRawMode(child);

  // 注入管道:QueuedInjector 负责 idle 推断 + 排队,注入动作用 writeToPty。
  // onInjected 接到 QueuedInjector 的状态回调:状态转 idle→busy 即注入了一条,
  // 用队列深度差推断“这次注入了什么”过于脆弱,因此这里改为在 inject 函数里
  // 直接回调(注入发生在 writeToPty 的成功路径)。
  const qi = new QueuedInjector((text: string): boolean => {
    const ok = writeToPty(child)(text);
    if (ok) onInjected?.(text);
    return ok;
  });

  // ── 1. 用户键盘 → 目标(stdin 置 raw,逐字节透传)──
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (d: Buffer) => {
    child.write(d.toString());
  });

  // ── 2. 目标输出 → 用户屏幕 + 旁路给 QueuedInjector 做 idle 推断 ──
  child.onData((d: string) => {
    process.stdout.write(d);
    qi.observeOutput();
  });

  // ── 窗口大小同步 ──
  const onResize = () => {
    child.resize(process.stdout.columns || 80, process.stdout.rows || 24);
  };
  process.stdout.on("resize", onResize);

  // ── 3. club feed:实时消息 → 单行化 → 入队(等 idle 注入)──
  const stopFeed = feedFactory({
    enqueue: (t: string) => qi.enqueue(t),
  });

  // ── 退出清理 ──
  const cleanup = () => {
    try { qi.dispose(); } catch { /* */ }
    try { stopFeed(); } catch { /* */ }
    try { process.stdin.setRawMode(false); } catch { /* */ }
  };

  return new Promise<number>((resolve) => {
    child.onExit(({ exitCode }) => {
      cleanup();
      resolve(exitCode ?? 0);
    });
    process.on("SIGINT", () => { cleanup(); process.exit(130); });
    process.on("SIGTERM", () => { cleanup(); process.exit(143); });
  });
}

/**
 * 从 parent 侧用 TCSANOW 把 PTY 设成 raw mode。
 *
 * 根因:claude code / codex 启动时调用 TCSETSW 设 raw mode,但 TCSETSW
 * 要求进程是 foreground process。在 PTY 里目标不是 foreground,
 * TCSETSW 返回 ERESTARTSYS,目标卡在重试循环 → 注入的输入没人读。
 * 修复:用 TCSANOW(立即生效)从 parent 侧先设 raw mode,目标的 TCSETSW
 * 立即成功(PTY 已经是 raw),目标进入事件循环,注入生效。
 *
 * 静默忽略失败:非 TUI 目标不需要 raw mode。
 */
function applyRawMode(child: pty.IPty): void {
  const ptySlave = (child as unknown as { _pty?: unknown })._pty;
  if (!ptySlave || typeof ptySlave !== "string") return;
  try {
    execSync(
      `python3 -c "
import termios, os
fd = os.open('${ptySlave}', os.O_RDWR | os.O_NONBLOCK)
new = termios.tcgetattr(fd)
new[0] = 0
new[1] = 0
new[2] = new[2] & ~(termios.CSIZE | termios.PARENB) | termios.CS8
new[3] = 0
termios.tcsetattr(fd, termios.TCSANOW, new)
os.close(fd)
"`,
      { stdio: "ignore" },
    );
  } catch {
    // 静默忽略:非 TUI 目标不需要 raw mode
  }
}
