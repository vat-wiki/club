import { Command } from "commander";
import { ClubClient } from "@club/sdk";
import { formatMessage } from "./format.js";
import { requireConfig } from "../config.js";
import type { Mention } from "@club/shared";

// A mention points at a message; render it like a normal message line so the
// agent/human sees the same shape it would from `club read`. We use the
// mention's own messageCreatedAt/author/content (denormalized on the server)
// rather than re-fetching the message.
function formatMention(m: Mention): string {
  return formatMessage({
    id: m.messageId,
    participantId: m.authorId,
    authorName: m.authorName,
    authorKind: m.authorKind,
    content: m.content,
    createdAt: m.messageCreatedAt,
    // Mention now carries its source room (multi-room); include it so the
    // synthesized Message satisfies the required `room` field.
    room: m.room,
  });
}

export function makeMentionsCommand(): Command {
  return new Command("mentions")
    .description("show your unread @-mentions; --read to mark them read")
    .option("--read", "mark all listed mentions as read after printing")
    .action(async (opts: { read?: boolean }) => {
      const cfg = requireConfig();
      try {
        const client = new ClubClient(cfg);
        const list = await client.mentions();
        if (list.length === 0) {
          console.log("(no unread mentions)");
          return;
        }
        for (const m of list) console.log(formatMention(m));
        if (opts.read) {
          // Mark each in turn. A mention that another concurrent reader
          // already marked will 409; we treat that as success (it's read).
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
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    });
}
