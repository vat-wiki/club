// club search <query>
//
// Search messages by content substring. Returns matching messages from all rooms
// (or scoped to a specific room with --room), newest first.

import { Command } from "commander";

import { ClubClient, type Message } from "@club/sdk";
import { clampPositive,DEFAULT_ROOM } from "@club/shared";

import { formatMessage } from "./format.js";
import { withCatchExit } from "../catch-exit.js";
import { requireConfig } from "../config.js";

const SEARCH_LIMIT_DEFAULT = 20;
const SEARCH_LIMIT_MAX = 100;

/**
 * Clamp search result count to [1, 100].
 *
 * Reuses shared's `clampPositive` primitive for the [1, 500] floor/ceil so the
 * floor logic is not duplicated, but enforces search's lower ceiling (100 vs.
 * 500) since search results are a heavier read path. `undefined`/blank /
 * non-finite degrade to SEARCH_LIMIT_DEFAULT (20) — same UX as `read`.
 */
export function parseSearchLimit(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return SEARCH_LIMIT_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return SEARCH_LIMIT_DEFAULT;
  return Math.min(clampPositive(n), SEARCH_LIMIT_MAX);
}

/** Dependency shape for `runSearch`, injected by the CLI action or by tests. */
export interface SearchDeps {
  /** Simulate `ClubClient.search(query, opts)`. */
  search: (query: string, opts: { room?: string; limit: number }) => Promise<Message[]>;
}

export interface SearchInput {
  query: string;
  room?: string;
  limit: number;
}

/**
 * Run the search and print results (newest first via reverse).
 *
 * Dependency injection keeps this function testable without a real server;
 * the commander action resolves `cfg.server + client` then delegates.
 */
export function runSearch(input: SearchInput, deps: SearchDeps): Promise<void> {
  return (async () => {
    const results = await deps.search(input.query, {
      room: input.room,
      limit: input.limit,
    });
    if (results.length === 0) {
      console.log(`no results for "${input.query}"`);
      return;
    }
    console.log(`found ${results.length} message${results.length !== 1 ? "s" : ""}:`);
    for (const msg of [...results].reverse()) {
      const roomTag = msg.room !== DEFAULT_ROOM ? `[#${msg.room}] ` : "";
      console.log(`  ${roomTag}${formatMessage(msg)}`);
    }
  })();
}

/**
 * Build the `club search` commander sub-command.
 *
 * Searches messages by content substring. Returns matching messages from all
 * rooms (or scoped to a specific room with `--room`), newest first. The limit
 * is clamped to [1, 100] (default 20) via shared's `clampPositive` so the
 * floor/ceil primitive is not duplicated, while search retains its own lower
 * ceiling since searches are a heavier read path than reads.
 *
 * @returns A configured `Command` instance to register with the CLI program.
 */
export function makeSearchCommand(): Command {
  return new Command("search")
    .description("search messages by content (newest first)")
    .argument("<query>", "text to search for")
    .option("--room <slug>", "scope to a specific room (default: all rooms)")
    .option("--limit <n>", `max results (default: ${SEARCH_LIMIT_DEFAULT}, max: ${SEARCH_LIMIT_MAX})`, String(SEARCH_LIMIT_DEFAULT))
    .action(
      withCatchExit(async (query: string, opts: { room?: string; limit?: string }) => {
        const cfg = requireConfig();
        const client = new ClubClient(cfg);
        return runSearch(
          { query: query.trim(), room: opts.room ?? undefined, limit: parseSearchLimit(opts.limit) },
          { search: (q, o) => client.search(q, o) },
        );
      }),
    );
}
