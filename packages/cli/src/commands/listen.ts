import { Command } from "commander";
import { ClubClient } from "@club/sdk";
import { mentionMatches, type Message } from "@club/shared";
import { requireConfig } from "../config.js";
import { formatMessage } from "./format.js";

export function makeListenCommand(): Command {
  return new Command("listen")
    .description("follow the live stream; optionally block until someone @mentions you")
    .option("--mention <name>", "print+exit when a message @<name> appears")
    .option("--once", "with --mention, exit after the first match (default true)")
    .action(async (opts: { mention?: string; once?: boolean }) => {
      const cfg = requireConfig();
      const mention = opts.mention;
      const once = opts.once ?? true; // default: exit on first @

      const sub = new ClubClient(cfg).stream((m: Message) => {
        // Skip until someone @-mentions `mention`. Matching is shared with the
        // server inbox and MCP via @club/shared mentionMatches (word-boundary),
        // so a live listen catches exactly what the offline inbox would deliver.
        if (mention && !mentionMatches(m.content, mention)) return;
        console.log(formatMessage(m));
        if (mention && once) {
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
