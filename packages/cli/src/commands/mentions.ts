// club mentions [--room <slug>]
//
// Print the current participant's unread @-mentions in chronological order
// (oldest first), scoped to the current room (or --room <slug>). Also used
// by `club me --mentions` as the underlying listing; `formatMention` is
// pure so both callers share one rendering path.

import { Command } from "commander";

import { ClubClient } from "@club/sdk";
import type { Mention } from "@club/shared";

import { formatMessage } from "./format.js";
import { withCatchExit } from "../catch-exit.js";
import { requireConfig } from "../config.js";

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

export interface MentionDeps {
  mentions: () => Promise<Mention[]>;
  markMentionsRead: (ids: string[]) => Promise<Mention[]>;
}

export async function runMentions(
  opts: { read?: boolean },
  deps: MentionDeps,
): Promise<void> {
  const list = await deps.mentions();
  if (list.length === 0) {
    console.log("(no unread mentions)");
    return;
  }
  for (const m of list) console.log(formatMention(m));
  if (opts.read) {
    try {
      await deps.markMentionsRead(list.map((m) => m.id));
      console.log(`(marked ${list.length} read)`);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 409) throw err;
      console.log(`(already read)`);
    }
  }
}

export function makeMentionsCommand(): Command {
  return new Command("mentions")
    .description("show your unread @-mentions; --read to mark them read")
    .option("--read", "mark all listed mentions as read after printing")
    .action(withCatchExit(async (opts: { read?: boolean }) => {
      const cfg = requireConfig();
      const client = new ClubClient(cfg);
      return runMentions(opts, {
        mentions: () => client.mentions(),
        markMentionsRead: (ids) => client.markMentionsRead(ids),
      });
    }));
}
