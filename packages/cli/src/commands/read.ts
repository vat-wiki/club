import { Command } from "commander";
import { getMessages } from "../client.js";
import { requireConfig } from "../config.js";
import { formatMessage } from "./format.js";

export function makeReadCommand(): Command {
  return new Command("read")
    .description("print recent messages (one-shot)")
    .option("--since <id>", "show messages after this message id")
    .option("--limit <n>", "number of messages", "50")
    .action(async (opts: { since?: string; limit: string }) => {
      const cfg = requireConfig();
      try {
        const msgs = await getMessages(cfg, {
          since: opts.since,
          limit: Number(opts.limit) || 50,
        });
        for (const m of msgs) console.log(formatMessage(m));
        if (msgs.length === 0) console.log("(no messages)");
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    });
}