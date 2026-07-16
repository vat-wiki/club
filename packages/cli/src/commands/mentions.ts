import { Command } from "commander";
import { ClubClient } from "@club/sdk";
import { formatMessage } from "./format.js";
import { requireConfig } from "../config.js";
import type { Mention } from "@club/shared";

function formatMention(m: Mention): string {
  return formatMessage({
    id: m.messageId,
    participantId: m.authorId,
    authorName: m.authorName,
    content: m.content,
    createdAt: m.messageCreatedAt,
    room: m.room,
  });
}

export function makeMentionsCommand(): Command {
  return new Command("mentions")
    .description("show your unread @-mentions; --read to mark them read")
    .option("--read", "mark all listed mentions as read after printing")
    .action(async (opts: { read?: boolean }) => {
      const cfg = requireConfig();
      const client = new ClubClient(cfg);
      const list = await client.mentions();
      if (list.length === 0) {
        console.log("(no unread mentions)");
        return;
      }
      for (const m of list) console.log(formatMention(m));
      if (opts.read) {
        for (const m of list) {
          try {
            await client.markMentionRead(m.id);
          } catch (err) {
            const status = (err as { status?: number }).status;
            if (status !== 409) throw err;
          }
        }
        console.log(`(marked ${list.length} read)`);
      }
    });
}
