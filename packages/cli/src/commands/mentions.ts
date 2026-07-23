// club mentions [--read]
//
// Pull the current participant's unread @-mentions and forward each into the
// local notify-panel inbox, then mark the delivered ones read. club CLI no
// longer prints messages to stdout — the inbox is the single place an agent
// "checks → acts".
//
// Marking read is the dedup contract: the next poll never re-forwards the same
// mention, so cron can run `club mentions` repeatedly without flooding the
// inbox. The old `--read` flag is now always-on (forwarding without marking
// would re-fire on every poll); it is kept as a no-op for back-compat so
// existing cron invocations `club mentions --read` keep working unchanged.
//
// `mentions` is the polling half of the two reception paths (the other is the
// long-running `listen` forwarder). All mentions are @-mentions of the caller,
// so every forwarded notification carries severity=warning.
//
// notify-panel is a mandatory base dependency; the preAction hook guarantees it
// is installed + running before this command's action fires.

import { Command } from "commander";

import { ClubClient } from "@club/sdk";
import type { Mention, Message } from "@club/shared";

import { formatMessage } from "./format.js";
import { withCatchExit } from "../catch-exit.js";
import { requireConfig } from "../config.js";
import { ensureNotifyPanel } from "../ensure-notify-panel.js";
import { type PushInput,pushMessage } from "../notify.js";

export function formatMention(m: Mention): string {
  return formatMessage({
    id: m.messageId,
    participantId: m.authorId,
    authorName: m.authorName,
    content: m.content,
    createdAt: m.messageCreatedAt,
    room: m.room,
  });
}

/** Reduce a Mention to the Message shape the notify-panel pusher expects. */
export function mentionToMessage(m: Mention): Message {
  return {
    id: m.messageId,
    participantId: m.authorId,
    authorName: m.authorName,
    content: m.content,
    createdAt: m.messageCreatedAt,
    room: m.room,
  };
}

export interface MentionDeps {
  mentions: () => Promise<Mention[]>;
  markMentionsRead: (ids: string[]) => Promise<Mention[]>;
  /** Mark a single mention read by id (per-id endpoint). */
  markMentionRead: (id: string) => Promise<Mention>;
  /** Forward a message to the notify-panel inbox. Best-effort: never throws. */
  push: (m: Message) => Promise<boolean>;
}

/**
 * Mark every mention read, with a per-id fallback for older servers.
 *
 * Newer servers expose `POST /me/mentions/read` (batch) and return the updated
 * rows. Older servers lack that route and answer 404; in that case we fall back
 * to the per-id `POST /me/mentions/:id/read` loop so the dedup contract (next
 * poll must not re-forward) still holds. A per-id 409 (already read by a
 * concurrent poll) is swallowed; a per-id 404 (mention vanished mid-batch) is
 * also swallowed so one stale row can't abort the rest.
 */
export async function markAllRead(
  ids: string[],
  deps: Pick<MentionDeps, "markMentionsRead" | "markMentionRead">,
): Promise<void> {
  try {
    await deps.markMentionsRead(ids);
    return;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 404) {
      // 409 (already read) is fine; anything else propagates.
      if (status !== 409) throw err;
      return;
    }
  }
  // 404 from the batch route → older server without it; fall back to per-id.
  await Promise.all(
    ids.map(async (id) => {
      try {
        await deps.markMentionRead(id);
      } catch (err) {
        const status = (err as { status?: number }).status;
        // 409 = already read (fine), 404 = vanished mid-batch (fine); others throw.
        if (status !== 409 && status !== 404) throw err;
      }
    }),
  );
}

/**
 * Orchestrates the `mentions` command: fetch unread @-mentions → push each to
 * the notify-panel inbox → mark them all read (dedup contract). Empty result is
 * a silent no-op (no inbox noise on a quiet poll).
 *
 * **Data-loss guard**: a mention is only marked read AFTER its push succeeds.
 * If `push` resolves false (daemon unreachable) the mention is left unread on
 * the server, so the next poll re-attempts it — no message is silently dropped.
 * Marking is best-effort per successfully-pushed id: a `markAllRead` failure
 * surfaces to the caller (the command exits non-zero) but already-pushed
 * notifications are already in the inbox, so a retry just re-pushes + re-marks;
 * the dedup-by-read-state still holds because re-pushed ids get marked on retry.
 *
 * @param _opts - Legacy `--read` flag; now always-on, so ignored.
 * @param deps - Injected fetch/markRead/push so the pure logic is unit-testable.
 */
export async function runMentions(
  _opts: { read?: boolean },
  deps: MentionDeps,
): Promise<void> {
  const list = await deps.mentions();
  if (list.length === 0) return; // quiet poll: no "(no unread mentions)" spam

  // Push first; track which ids actually landed in the inbox. A failed push
  // leaves that mention unread on the server so the next poll retries it —
  // never mark-read what we couldn't deliver (that would lose the message).
  const pushed: string[] = [];
  for (const m of list) {
    const ok = await deps.push(mentionToMessage(m));
    if (ok) pushed.push(m.id);
  }

  // Nothing delivered → leave everything unread; a later poll retries.
  if (pushed.length === 0) return;

  await markAllRead(pushed, deps);
}

export function makeMentionsCommand(): Command {
  return new Command("mentions")
    .description("forward your unread @-mentions into your notify-panel inbox")
    .option("--read", "(default: on) kept for back-compat; mentions are always marked read")
    .action(
      withCatchExit(async (opts: { read?: boolean }) => {
        const cfg = requireConfig();
        const client = new ClubClient(cfg);

        // Base dependency gate: notify-panel must be installed + reachable.
        const conn: PushInput | null = await ensureNotifyPanel();
        if (!conn) {
          throw new Error(
            "notify-panel is required but not available; run: npm i -g notify-panel && notify-panel start",
          );
        }

        return runMentions(opts, {
          mentions: () => client.mentions(),
          markMentionsRead: (ids) => client.markMentionsRead(ids),
          markMentionRead: (id) => client.markMentionRead(id),
          push: (m) => pushMessage(m, conn, { severity: "warning" }),
        });
      }),
    );
}
