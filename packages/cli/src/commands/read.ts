import { Command } from "commander";
import { ClubClient } from "@club/sdk";
import { defaultRoom, requireConfig } from "../config.js";
import { parseLimit } from "../limit.js";
import { formatMessage } from "./format.js";

export function makeReadCommand(): Command {
  return new Command("read")
    .description("print recent messages (one-shot)")
    .option("--since <id>", "show messages after this message id")
    .option("--before <id>", "show messages before this message id (older history)")
    .option("--limit <n>", "number of messages", "50")
    .option(
      "--room <slug>",
      "read from this room (default: the room from `club enter`, or general)",
    )
    .action(
      async (opts: { since?: string; before?: string; limit: string; room?: string }) => {
        const cfg = requireConfig();
        try {
          const msgs = await new ClubClient(cfg).messages({
            since: opts.since,
            before: opts.before,
            limit: parseLimit(opts.limit),
            // Same resolution as send: flag → config default → general.
            room: opts.room ?? defaultRoom(cfg),
          });
          for (const m of msgs) console.log(formatMessage(m));
          if (msgs.length === 0) console.log("(no messages)");
        } catch (err) {
          console.error((err as Error).message);
          process.exit(1);
        }
      },
    );
}