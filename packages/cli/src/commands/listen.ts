import { Command } from "commander";
import { ClubClient } from "@club/sdk";
import { mentionMatches, type Message } from "@club/shared";
import { requireConfig } from "../config.js";
import { formatMessage } from "./format.js";
import { withCatchExit } from "../catch-exit.js";

export function makeListenCommand(): Command {
  return new Command("listen")
    .description("follow the live stream; optionally block until someone @mentions you")
    .option("--mention <name>", "print+exit when a message @<name> appears")
    .option("--once", "with --mention, exit after the first match (default true)")
    .option(
      "--room <slug>",
      "listen to one room only (default: all rooms — a mention in any room wakes you)",
    )
    .action(withCatchExit((opts: { mention?: string; once?: boolean; room?: string }) => {
      const cfg = requireConfig();
      const mention = opts.mention;
      const once = opts.once ?? true;
      const client = new ClubClient(cfg);
      const streamOpts = opts.room ? { room: opts.room } : {};

      const reportThinking = (m: Message) => {
        if (!mention || !mentionMatches(m.content, mention)) return;
        // Best-effort: a transient thinking-report failure should never
        // interrupt the live stream for the user; swallow silently.
        // eslint-disable-next-line @typescript-eslint/no-empty-function -- intentional best-effort swallow
        void client.reportAgentThinking(m.room).catch(() => {});
      };

      const sub = client.stream(
        (m: Message) => {
          if (mention && !mentionMatches(m.content, mention)) return;
          reportThinking(m);
          console.log(formatMessage(m));
          if (mention && once) {
            sub.stop();
            process.exit(0);
          }
        },
        streamOpts,
      );

      process.on("SIGINT", () => {
        sub.stop();
        process.exit(0);
      });
    }));
}
