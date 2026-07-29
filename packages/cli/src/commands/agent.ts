// club agent -- <cmd> [args...]
//
// 把任意交互式 TUI agent(claude / codex / gemini-cli / …)起在一个伪终端里,
// club 的实时 SSE 消息被格式化成单行后**直接当作"用户敲的字"注入**,让
// agent 被外部事件当场唤醒处理。
//
//   club SSE ──直连──▶ PTY 注入 ──▶ 这个 TUI agent
//
// 这是 club 唯一的实时接入姿势:不经过收件箱/中转 daemon,消息来了就驱动。
// (早期版本的 `club listen` 曾用 notify-panel 收件箱中转,现已移除。)
//
// 用法:
//   club agent claude                                  # 起一个 claude
//   club agent -- claude -p "你是一个 AI 助手"           # 带参数(用 -- 分隔)
//   club agent --room dev --mention rex -- codex       # 只订阅某房间 / 只收 @我
//
// 忙就不注入:目标持续输出(干活)时消息排队,目标静默 ≥1.5s(idle)才出队
// 注入一条,注入后冷却 2s 等目标"接住"再判下一条。保证不打断正在响应的 agent。

import { Command } from "commander";

import { ClubClient } from "@vatwiki/sdk";

import { startFeed } from "../agent/feed.js";
import { runAgent } from "../agent/pty.js";
import { withCatchExit } from "../catch-exit.js";
import { requireConfig } from "../config.js";

/**
 * Build the `club agent` commander sub-command.
 *
 * Commander 把 `--` 之后的 token 当作 positional,不再解析为选项 —— 正是
 * 我们要的:目标命令自带的 `-p` / `--config` 等不会被 club 误吞。`--`
 * 之前的 token 归 club(agent 子命令自己的选项)。
 *
 * @returns A configured `Command` instance to register with the CLI program.
 */
export function makeAgentCommand(): Command {
  return new Command("agent")
    .description(
      "run a TUI agent in a PTY and inject live club messages into it (no notify-panel needed)",
    )
    .option(
      "-r, --room <slug>",
      "subscribe to this room only (default: all rooms)",
    )
    .option(
      "--mention <name>",
      "only deliver messages that @<name> (default: all messages except your own)",
    )
    .argument(
      "[cmd...]",
      "the TUI agent to run and its args (use -- to separate, so club won't swallow its flags)",
    )
    .allowExcessArguments(true)
    .action(
      withCatchExit(async (cmdArgs: string[], opts: { room?: string; mention?: string }) => {
        if (!cmdArgs || cmdArgs.length === 0) {
          console.error(
            "error: club agent needs a TUI agent to run, e.g.:\n" +
              "  club agent claude\n" +
              "  club agent -- claude -p 'you are an AI assistant'\n" +
              "  club agent --room dev --mention rex -- codex",
          );
          process.exit(2);
        }

        const [cmd, ...args] = cmdArgs;
        const cfg = requireConfig();
        const client = new ClubClient(cfg);

        // 解析自己的身份:用于跳过自己发的消息(避免回声)。best-effort,
        // /me 失败就不做自回声过滤 —— 安全降级(最坏只是 agent 会收到自己发的)。
        // 严重度(@与)由 mentionMatches 在 feed 内推导,不需 name。
        let meId: string | undefined;
        try {
          const me = await client.me();
          meId = me.id;
        } catch {
          // 降级:不做自回声过滤
        }

        // feedFactory:把 club stream 接到 QueuedInjector 上。
        // 这里才真正创建数据源 —— runAgent 内部在 PTY 起好后调用它,
        // 保证 agent 一启动就开始收消息。
        const feedFactory = (inject: { enqueue: (t: string) => void }) => {
          return startFeed(client, {
            inject,
            room: opts.room,
            mention: opts.mention,
            meId,
            onDelivered: (n) => {
              if (n === 1) process.stderr.write("club agent: first message delivered\n");
            },
            onError: (err) => {
              process.stderr.write(`club agent: stream error ${err.message}\n`);
            },
          });
        };

        process.stderr.write(
          `club agent: starting ${cmd} ${args.join(" ")} (room: ${opts.room ?? "all"}` +
            `${opts.mention ? ", mention: " + opts.mention : ""})\n`,
        );

        const code = await runAgent(
          { cmd, args },
          feedFactory,
          (text) => {
            process.stderr.write(`club agent: injected ${text.length} chars\n`);
          },
        );
        process.exit(code);
      }),
    );
}
