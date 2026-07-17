import { Command } from "commander";
import { ClubClient } from "@club/sdk";
import type { Message } from "@club/shared";
import { defaultRoom, requireConfig } from "../config.js";
import { parseLimit } from "../limit.js";
import { formatMessage } from "./format.js";

/** Message extended with a runtime-authoritive kind hint for icon display. */
type MessageWithKind = Message & { authorKind?: "agent" | "human" };

function formatMessageWithIds(m: MessageWithKind): string {
  const t = new Date(m.createdAt);
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  const icon = m.authorKind === "agent" ? "🤖" : "🧑";

  if (m.deleted) {
    return `[${hh}:${mm}] ${icon}${m.authorName}: (recalled)`;
  }

  const media = (m.attachments ?? [])
    .map((a) => {
      if (a.mime.startsWith("video/")) return `[视频: ${a.url} id:${a.id}]`;
      if (a.mime.startsWith("image/")) return `[图片: ${a.url} id:${a.id}]`;
      return `[文件: ${a.filename ?? a.id} id:${a.id}]`;
    })
    .join(" ");
  const body = media ? `${m.content} ${media}`.trim() : m.content;

  const reactions = (m.reactions ?? [])
    .map((r) => `${r.emoji}(${r.count})`)
    .join(" ");

  const base = `[${hh}:${mm}] ${icon}${m.authorName}: ${body}`;
  return reactions ? `${base} ${reactions}` : base;
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
    .option("--show-ids", "show attachment IDs (for use with `club cat`)")
    .action(
      async (opts: { since?: string; before?: string; limit: string; room?: string; showIds?: boolean }) => {
        const cfg = requireConfig();
        const msgs = await new ClubClient(cfg).messages({
          since: opts.since,
          before: opts.before,
          limit: parseLimit(opts.limit),
          room: opts.room ?? defaultRoom(cfg),
        });
        const formatter = opts.showIds ? formatMessageWithIds : formatMessage;
        for (const m of msgs) console.log(formatter(m));
        if (msgs.length === 0) console.log("(no messages)");
      },
    );
}