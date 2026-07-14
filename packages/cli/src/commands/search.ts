// club search <query>
//
// Search messages by content substring. Returns matching messages from all rooms
// (or scoped to a specific room with --room), newest first.

import { Command } from "commander";
import { ClubClient } from "@club/sdk";
import { defaultRoom, requireConfig } from "../config.js";
import { formatMessage } from "./format.js";

export function makeSearchCommand(): Command {
  return new Command("search")
    .description("search messages by content (newest first)")
    .argument("<query>", "text to search for")
    .option("--room <slug>", "scope to a specific room (default: all rooms)")
    .option("--limit <n>", "max results (default: 20, max: 100)", "20")
    .action(async (query: string, opts: { room?: string; limit?: string }) => {
      const cfg = requireConfig();
      const client = new ClubClient(cfg);
      const limit = Math.min(Math.max(1, Number(opts.limit) || 20), 100);
      const room = opts.room ?? undefined;

      const results = await client.search(query.trim(), { room, limit });
      if (results.length === 0) {
        console.log(`no results for "${query}"`);
        return;
      }
      console.log(`found ${results.length} message${results.length !== 1 ? "s" : ""}:`);
      for (const msg of [...results].reverse()) {
        const roomTag = msg.room !== "general" ? `[#${msg.room}] ` : "";
        console.log(`  ${roomTag}${formatMessage(msg)}`);
      }
    });
}
