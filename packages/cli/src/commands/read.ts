import { Command } from "commander";

import type { ClubClient, Message } from "@club/sdk";
import { formatMessage } from "@club/sdk";

import { withCatchExit } from "../catch-exit.js";
import { defaultRoom, requireConfig } from "../config.js";
import { parseLimit } from "../limit.js";

export interface ReadOpts {
  /** Only messages after this message id. */
  since?: string;
  /** Only messages before this message id (older history). */
  before?: string;
  /** Maximum number of messages to fetch. */
  limit: string;
  /** Room slug; defaults to the room from `club enter`, or general. */
  room?: string;
}

export interface ReadDeps {
  /** Resolve the authenticated `ClubClient`. */
  getClient: () => ClubClient;
  /** Format a message for stdout. */
  formatMessage: (m: Message) => string;
  /** Parse a numeric `--limit` argument. */
  parseLimit: (s: string) => number;
  /** Default room fallback when no `--room` is passed. */
  defaultRoom: () => string;
}

/**
 * Fetch and print recent messages for a room (one-shot).
 *
 * @param opts - Parsed CLI options (`since`, `before`, `limit`, `room`).
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
    limit: deps.parseLimit(opts.limit),
    room: opts.room ?? deps.defaultRoom(),
  });
  for (const m of msgs) console.log(deps.formatMessage(m));
  if (msgs.length === 0) console.log("(no messages)");
}

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
      withCatchExit(
        async (opts: ReadOpts) => {
          const cfg = requireConfig();
          const { ClubClient } = await import("@club/sdk");
          return runRead(opts, {
            getClient: () => new ClubClient(cfg),
            formatMessage,
            parseLimit,
            defaultRoom: () => defaultRoom(cfg),
          });
        },
      ),
    );
}
