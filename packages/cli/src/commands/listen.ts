import { Command } from "commander";
import { streamMessages } from "../client.js";
import { requireConfig } from "../config.js";
import { formatMessage } from "./format.js";
import type { Message } from "@club/shared";

export function makeListenCommand(): Command {
  return new Command("listen")
    .description("follow the live stream; optionally block until someone @mentions you")
    .option("--mention <name>", "print+exit when a message @<name> appears")
    .option("--once", "with --mention, exit after the first match (default true)")
    .action(async (opts: { mention?: string; once?: boolean }) => {
      const cfg = requireConfig();
      const mention = opts.mention;
      const once = opts.once ?? true; // default: exit on first @
      const token = mention ? "@" + mention.toLowerCase() : null;

      const sub = streamMessages(cfg, (m: Message) => {
        if (token) {
          const hit = m.content.toLowerCase().includes(token);
          if (!hit) return; // silently skip until matched
        }
        console.log(formatMessage(m));
        if (token && once) {
          sub.stop();
          process.exit(0);
        }
      });

      // Without --mention, stream forever (until Ctrl-C).
      process.on("SIGINT", () => {
        sub.stop();
        process.exit(0);
      });
    });
}