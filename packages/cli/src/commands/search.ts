// club search <query>
//
// Search messages by content substring. Returns matching messages from all rooms
// (or scoped to a specific room with --room), newest first.

import { Command } from "commander";
import { ClubClient } from "@club/sdk";
import { defaultRoom, requireConfig } from "../config.js";
import { formatMessage } from "./format.js";

const SEARCH_LIMIT_DEFAULT = 20;
const SEARCH_LIMIT_MAX = 100;

/** Clamp search limit the same way `read` clamps, but search's own defaults. */
function parseSearchLimit(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return SEARCH_LIMIT_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return SEARCH_LIMIT_DEFAULT;
  return Math.min(Math.max(1, Math.floor(n)), SEARCH_LIMIT_MAX);
}

export function makeSearchCommand(): Command {
  return new Command("search")
    .description("search messages by content (newest first)")
    .argument("<query>", "text to search for")
    .option("--room <slug>", "scope to a specific room (default: all rooms)")
    .option("--limit <n>", `max results (default: ${SEARCH_LIMIT_DEFAULT}, max: ${SEARCH_LIMIT_MAX})`, String(SEARCH_LIMIT_DEFAULT))
    .action(async (query: string, opts: { room?: string; limit?: string }) => {
      const cfg = requireConfig();
      const client = new ClubClient(cfg);
      const limit = parseSearchLimit(opts.limit);
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
