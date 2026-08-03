// club search <query>
//
// Search messages by content substring. Returns matching messages from all channels
// (or scoped to a specific channel with --channel), newest first.

import { Command } from "commander";

import { ClubClient, type Message } from "@club/sdk";
import { clampPositive,DEFAULT_CHANNEL } from "@club/shared";

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
  search: (query: string, opts: { channel?: string; limit: number }) => Promise<Message[]>;
  /** Server base URL, to resolve attachment urls to absolute in the output. */
  server?: string;
}

export interface SearchInput {
  query: string;
  channel?: string;
  limit: number;
  /** Emit JSON (one array, with message ids) instead of human-readable lines. */
  json?: boolean;
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
      channel: input.channel,
      limit: input.limit,
    });
    if (input.json) {
      // Machine-readable: full message objects (incl. id), newest-first as the
      // API returns them. The human view omits ids to stay scannable; --json is
      // the id source for `send -R`/`edit`/`delete`/`react`/`read --around`.
      process.stdout.write(JSON.stringify(results) + "\n");
      return;
    }
    if (results.length === 0) {
      console.log(`no results for "${input.query}"`);
      return;
    }
    console.log(`found ${results.length} message${results.length !== 1 ? "s" : ""}:`);
    for (const msg of [...results].reverse()) {
      const channelTag = msg.channel !== DEFAULT_CHANNEL ? `[#${msg.channel}] ` : "";
      console.log(`  ${channelTag}${formatMessage(msg, { server: deps.server })}`);
    }
  })();
}

/**
 * Build the `club search` commander sub-command.
 *
 * Searches messages by content substring. Returns matching messages from all
 * channels (or scoped to a specific channel with `--channel`), newest first. The limit
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
    .option("--channel <slug>", "scope to a specific channel (default: all channels)")
    .option("--limit <n>", `max results (default: ${SEARCH_LIMIT_DEFAULT}, max: ${SEARCH_LIMIT_MAX})`, String(SEARCH_LIMIT_DEFAULT))
    .option("--json", "emit JSON (one array, with message ids) instead of human-readable lines")
    .action(
      withCatchExit(async (query: string, opts: { channel?: string; limit?: string; json?: boolean }) => {
        const cfg = requireConfig();
        const client = new ClubClient(cfg);
        return runSearch(
          { query: query.trim(), channel: opts.channel ?? undefined, limit: parseSearchLimit(opts.limit), json: opts.json },
          { search: (q, o) => client.search(q, o), server: cfg.server },
        );
      }),
    );
}
