import { Command } from "commander";
import { ClubClient } from "@club/sdk";
import { requireConfig } from "../config.js";
import { parseLimit } from "../limit.js";
import { formatMessage } from "./format.js";

export function makeReadCommand(): Command {
  return new Command("read")
    .description("print recent messages (one-shot)")
    .option("--since <id>", "show messages after this message id")
    .option("--limit <n>", "number of messages", "50")
    .action(async (opts: { since?: string; limit: string }) => {
      const cfg = requireConfig();
      try {
        const msgs = await new ClubClient(cfg).messages({
          since: opts.since,
          limit: parseLimit(opts.limit),
        });
        for (const m of msgs) console.log(formatMessage(m));
        if (msgs.length === 0) console.log("(no messages)");
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    });
}