// club read [--channel <slug>] [--since <id>] [--before <id>] [--around <id>] [--limit <n>] [--json]
//
// Fetch and print messages. --since anchors to a message id (newer history),
// --before goes older, --around returns context around an id (a few before +
// the anchor + a few after), --limit caps the response (1-500, default 20).
// Defaults to general unless -r/--channel is explicit.
//
// --json emits the raw message objects (one JSON array, incl. each message's
// id) instead of human-readable lines. Use it to obtain the message ids that
// --since/--around and `send -R`/`edit`/`delete`/`react` need — the default
// human output intentionally omits ids to stay scannable.

import { Command } from "commander";

import type { ClubClient, Message } from "@club/sdk";

import { formatMessage } from "./format.js";
import { withCatchExit } from "../catch-exit.js";
import { defaultChannel, requireConfig } from "../config.js";
import { parseLimit } from "../limit.js";

export interface ReadOpts {
  /** Only messages after this message id. */
  since?: string;
  /** Only messages before this message id (older history). */
  before?: string;
  /** Context around this message id (a few before + the anchor + a few after). */
  around?: string;
  /** Maximum number of messages to fetch. */
  limit: string;
  /** Channel slug; defaults to general (DEFAULT_CHANNEL) when omitted. */
  channel?: string;
  /** Emit JSON (one array, with message ids) instead of human-readable lines. */
  json?: boolean;
}

export interface ReadDeps {
  /** Resolve the authenticated `ClubClient`. */
  getClient: () => ClubClient;
  /** Format a message for stdout. */
  formatMessage: (m: Message) => string;
  /** Parse a numeric `--limit` argument. */
  parseLimit: (s: string) => number;
  /** Default channel fallback when no `--channel` is passed. */
  defaultChannel: () => string;
}

/**
 * Fetch and print recent messages for a channel (one-shot).
 *
 * @param opts - Parsed CLI options (`since`, `before`, `limit`, `channel`).
 * @param deps - Injected dependencies for testability.
 */
export async function runRead(
  opts: ReadOpts,
  deps: ReadDeps,
): Promise<void> {
  const client = deps.getClient();
  const msgs = await client.messages({
    since: opts.since,
    before: opts.before,
    around: opts.around,
    limit: deps.parseLimit(opts.limit),
    channel: opts.channel ?? deps.defaultChannel(),
  });
  if (opts.json) {
    // Machine-readable: full message objects (incl. id) so callers can feed
    // --since/--around and `send -R`/`edit`/`delete`/`react` without eyeballing
    // ids. The human view omits ids to stay scannable; --json is the id source.
    process.stdout.write(JSON.stringify(msgs) + "\n");
    return;
  }
  for (const m of msgs) console.log(deps.formatMessage(m));
  if (msgs.length === 0) console.log("(no messages)");
}

/**
 * Build the `club read` commander sub-command.
 *
 * Fetches and prints messages from a channel (one-shot). Supports
 * pagination anchors (`--since` / `--before` / `--around`) and a configurable
 * `--limit` (1-500, default 20). Defaults to general unless `-r`/`--channel` is explicit.
 *
 * @returns A configured `Command` instance to register with the CLI program.
 */
export function makeReadCommand(): Command {
  return new Command("read")
    .description("print recent messages (one-shot)")
    .option("--since <id>", "show messages after this message id")
    .option("--before <id>", "show messages before this message id (older history)")
    .option("--around <id>", "show context around this message id (a few before + after)")
    .option("--limit <n>", "number of messages", "20")
    .option(
      "-r, --channel <slug>",
      "read from this channel (default: general)",
    )
    .option("--json", "emit JSON (one array, with message ids) instead of human-readable lines")
    .action(
      withCatchExit(
        async (opts: ReadOpts) => {
          const cfg = requireConfig();
          const { ClubClient } = await import("@club/sdk");
          return runRead(opts, {
            getClient: () => new ClubClient(cfg),
            formatMessage: (m) => formatMessage(m, { server: cfg.server }),
            parseLimit,
            defaultChannel: () => defaultChannel(),
          });
        },
      ),
    );
}
