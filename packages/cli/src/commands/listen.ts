// club listen [--mention <name>] [--room <slug>] [--once]
//
// Follow the live SSE stream and forward every matching message into the local
// notify-panel inbox. club CLI no longer prints messages to stdout — the inbox
// is the single place an agent "checks → acts". Without flags it forwards every
// message across all rooms; with --mention <name> it filters to messages that
// @-mention the target.
//
// Default is a long-running forwarder: it stays attached to the SSE stream and
// keeps pushing until killed (SIGINT/SIGTERM). `--once` is kept for back-compat
// with the old "exit-on-first-match wake-up signal" cron scripts: when set, the
// first forwarded message exits 0 (so existing `club listen --mention x --once`
// invocations keep working, now also pushing that one message into the inbox).
//
// Severity: a message is `warning` if it @-mentions us (our own name, resolved
// via GET /me — not the --mention filter, which may differ), else `info`.
//
// notify-panel is a mandatory base dependency; ensureNotifyPanel() guarantees it
// is installed + running before this command's action fires.

import { Command } from "commander";

import { ClubClient } from "@club/sdk";
import { mentionMatches, type Message } from "@club/shared";

import { withCatchExit } from "../catch-exit.js";
import { requireConfig } from "../config.js";
import { ensureNotifyPanel } from "../ensure-notify-panel.js";
import { type PushInput, pushMessage } from "../notify.js";

/**
 * Build the `club listen` commander sub-command.
 *
 * Follows the live SSE stream and forwards every matching message to the local
 * notify-panel inbox (no stdout). Without flags it forwards every message
 * across all rooms; `--mention <name>` filters to messages that @-mention the
 * target. Long-running by default (SIGINT/SIGTERM to stop); `--once` exits 0
 * after the first forwarded message, for back-compat with old wake-up cron jobs.
 *
 * @returns A configured `Command` instance to register with the CLI program.
 */
export function makeListenCommand(): Command {
  return new Command("listen")
    .description("forward the live stream into your notify-panel inbox")
    .option("--mention <name>", "only forward messages that @<name>")
    .option(
      "--room <slug>",
      "listen to one room only (default: all rooms — a mention in any room is forwarded)",
    )
    .option(
      "--once",
      "exit 0 after the first forwarded message (back-compat wake-up mode; default: stream forever)",
    )
    .action(
      withCatchExit(async (opts: { mention?: string; room?: string; once?: boolean }) => {
        const cfg = requireConfig();
        const mention = opts.mention;
        const once = opts.once ?? false;
        const client = new ClubClient(cfg);

        // Base dependency gate: notify-panel must be installed + reachable.
        const conn: PushInput | null = await ensureNotifyPanel();
        if (!conn) {
          throw new Error(
            "notify-panel is required but not available; run: npm i -g notify-panel && notify-panel start",
          );
        }

        // Resolve our own name for severity (mention → warning). Best-effort:
        // if /me fails we fall back to the --mention filter, or none — severity
        // then degrades to `info`, which is safe.
        let meName: string | undefined;
        try {
          meName = (await client.me()).name;
        } catch {
          meName = mention;
        }

        const reportThinking = (m: Message) => {
          if (!mention || !mentionMatches(m.content, mention)) return;
          // Best-effort: a transient thinking-report failure should never
          // interrupt the live forwarder; swallow silently.
          // eslint-disable-next-line @typescript-eslint/no-empty-function -- intentional best-effort swallow
          void client.reportAgentThinking(m.room).catch(() => {});
        };

        let stopping = false;
        const stop = (sub: { stop: () => void }) => {
          if (stopping) return;
          stopping = true;
          sub.stop();
        };

        const sub = client.stream(
          async (m: Message) => {
            if (mention && !mentionMatches(m.content, mention)) return;
            reportThinking(m);
            // In --once mode we MUST await the push before exiting, or the
            // process dies before the HTTP request lands. In stream mode we
            // fire-and-forget but warn on failure — unlike `mentions`, a live
            // stream can't fall back on a server-side unread queue to retry,
            // so a dropped push is a dropped message; at least make it visible.
            if (once) {
              const ok = await pushMessage(m, conn, { meName });
              if (!ok) {
                process.stderr.write(
                  `club: failed to forward message ${m.id} to notify-panel; exiting anyway (--once).\n`,
                );
              }
              stop(sub);
              process.exit(0);
            } else {
              void pushMessage(m, conn, { meName }).then((ok) => {
                if (!ok) {
                  process.stderr.write(
                    `club: failed to forward message ${m.id} to notify-panel (message lost from live stream).\n`,
                  );
                }
              });
            }
          },
          opts.room ? { room: opts.room } : {},
        );

        const onSignal = () => {
          stop(sub);
          process.exit(0);
        };
        process.on("SIGINT", onSignal);
        process.on("SIGTERM", onSignal);

        // Keep the process alive for the stream callbacks; the stream itself
        // holds the connection but Node needs an unsettled macrotask to stay up.
        // The executor is intentionally empty (never resolves).
        // eslint-disable-next-line @typescript-eslint/no-empty-function -- intentional never-resolving keep-alive
        await new Promise<never>(() => {});
      }),
    );
}
