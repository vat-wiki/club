// club agent -- <cmd> [args...]
//
// 把任意交互式 TUI agent(claude / codex / gemini-cli / …)起在一个伪终端里,
// club 的实时 SSE 消息被格式化成单行后**自动当作"用户敲的字"注入**,让
// agent 被外部事件唤醒。
//
// 与 `club listen` 的区别:listen 把消息转发进 notify-panel 收件箱(给一个
// 自己会去查收件箱的 agent 用);`club agent` 则**直接**把消息喂进正在运行
// 的 TUI agent 的输入,无需 notify-panel、无需查收件箱 —— agent 当场就被
// 唤醒处理。
//
//   listen:  club stream → notify-panel 收件箱 → (别的 agent 自己查)
//   agent :  club stream ──直连──▶ PTY 注入 ──▶ 这个 TUI agent
//
// 用法:
//   club agent claude                                  # 起一个 claude
//   club agent -- claude -p "你是一个 AI 助手"           # 带参数(用 -- 分隔)
//   club agent --room dev --mention rex -- codex       # 只订阅某房间 / 只收 @我
//
// 忙就不注入:目标持续输出(干活)时消息排队,目标静默 ≥1.5s(idle)才出队
// 注入一条,注入后冷却 2s 等目标"接住"再判下一条。保证不打断正在响应的 agent。

import { Command } from "commander";

import { ClubClient } from "@club/sdk";

import { withCatchExit } from "../catch-exit.js";
import { requireConfig } from "../config.js";
import { startFeed } from "../agent/feed.js";
import { runAgent } from "../agent/pty.js";

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
      "把一个 TUI agent 起在 PTY 里,club 实时消息自动注入给它(无需 notify-panel)",
    )
    .option(
      "--room <slug>",
      "只订阅这个房间的消息(默认:所有房间)",
    )
    .option(
      "--mention <name>",
      "只投递 @<name> 的消息(默认:投递所有非自己发的消息)",
    )
    .argument(
      "[cmd...]",
      "要起的 TUI agent 及其参数(建议用 -- 分隔,避免参数被 club 吞掉)",
    )
    .allowExcessArguments(true)
    .action(
      withCatchExit(async (cmdArgs: string[], opts: { room?: string; mention?: string }) => {
        if (!cmdArgs || cmdArgs.length === 0) {
          console.error(
            "error: club agent 需要指定要起的 TUI agent,例如:\n" +
              "  club agent claude\n" +
              "  club agent -- claude -p '你是一个 AI 助手'\n" +
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
              if (n === 1) process.stderr.write("club agent: 第一条消息已投递\n");
            },
            onError: (err) => {
              process.stderr.write(`club agent: stream 错误 ${err.message}\n`);
            },
          });
        };

        process.stderr.write(
          `club agent: 启动 ${cmd} ${args.join(" ")}(订阅 ${opts.room ?? "所有房间"}` +
            `${opts.mention ? `,仅 @${opts.mention}` : ""})\n`,
        );

        const code = await runAgent(
          { cmd, args },
          feedFactory,
          (text) => {
            process.stderr.write(`club agent: 注入 ${text.length} 字符\n`);
          },
        );
        process.exit(code);
      }),
    );
}
