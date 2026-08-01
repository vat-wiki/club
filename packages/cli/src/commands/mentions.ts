// club mentions [--no-read] [--json]
//
// List YOUR unread @-mentions, oldest first. This is the direct way to answer
// "did anyone @ me?" without scanning history by eye.
//
//   club mentions            # print unread @-mentions (one-shot), mark them read
//   club mentions --no-read  # peek without marking (next run still sees them)
//   club mentions --json     # machine-readable output
//
// WHY mentions marks read (and `club read` does not): mentions are the ONLY
// entity in club with server-side read state (`Mention.readAt`). Club does
// not track per-message read state at all (PRD §5.2 — unread is client-side),
// so `read` has nothing to mark. But a @-mention is a persistent "todo": its
// unread state survives across devices/sessions, and marking it read is the
// dedup contract that lets a cron poll `club mentions` repeatedly without
// re-reporting the same @. This is the polling counterpart to `club agent`
// (real-time): for a cron / one-shot "any new @" check use this; for
// "stay online and react live" use `club agent`.

import { Command } from "commander";

import { ClubClient, type Mention } from "@club/sdk";

import { withCatchExit } from "../catch-exit.js";
import { requireConfig } from "../config.js";

/** Format a mention for human-readable stdout. */
export function formatMentionLine(m: Mention): string {
  const t = new Date(m.messageCreatedAt);
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  return `[${hh}:${mm}] @${m.authorName} in #${m.channel}: ${m.content}  (msg=${m.messageId})`;
}

export interface MentionsDeps {
  /** Fetch the caller's unread @-mentions (oldest first). */
  list: () => Promise<Mention[]>;
  /** Batch-mark the given mention ids as read. Returns updated rows. */
  markRead: (ids: string[]) => Promise<Mention[]>;
}

export interface MentionsOpts {
  /** Mark fetched mentions read after printing (default: on). */
  read?: boolean;
  /** Emit JSON (one array) instead of human-readable lines. */
  json?: boolean;
}

/**
 * Core: list unread @-mentions, optionally mark them read.
 *
 * Marking read is the dedup contract — a cron polling this repeatedly won't see
 * the same mention twice. `--no-read` peeks without marking (next run still
 * sees them).
 */
export async function runMentions(
  opts: MentionsOpts,
  deps: MentionsDeps,
): Promise<void> {
  const mentions = await deps.list();

  if (opts.json) {
    process.stdout.write(JSON.stringify(mentions) + "\n");
  } else if (mentions.length === 0) {
    process.stdout.write("(no unread @-mentions)\n");
  } else {
    for (const m of mentions) process.stdout.write(formatMentionLine(m) + "\n");
  }

  // Mark read by default (dedup). --no-read peeks.
  if (opts.read !== false && mentions.length > 0) {
    await deps.markRead(mentions.map((m) => m.id));
  }
}

/**
 * Build the `club mentions` commander sub-command.
 *
 * @returns A configured `Command` instance to register with the CLI program.
 */
export function makeMentionsCommand(): Command {
  return new Command("mentions")
    .description("list your unread @-mentions (one-shot; marks them read by default)")
    .option("--no-read", "peek without marking read (next run still sees them)")
    .option("--json", "emit JSON (one array) instead of human-readable lines")
    .action(
      withCatchExit(async (opts: MentionsOpts) => {
        const cfg = requireConfig();
        const client = new ClubClient(cfg);
        return runMentions(opts, {
          list: () => client.mentions(),
          markRead: (ids) => client.markMentionsRead(ids),
        });
      }),
    );
}
