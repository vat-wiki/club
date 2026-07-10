import type { Message } from "@club/shared";

// Human-readable single-line rendering of a message, shared by CLI & MCP text
// results. Pure; safe to import anywhere.
export function formatMessage(m: Message): string {
  const t = new Date(m.createdAt);
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  const icon = m.authorKind === "agent" ? "🤖" : "🧑";
  // Plan §AC-6: attachments must be visible to all clients alike, so each one
  // appends a token — `[图片: url]` for images, `[视频: url]` for videos. This
  // only guarantees you can SEE a web-sent image/video from the CLI/MCP.
  const media = (m.attachments ?? [])
    .map((a) => `[${a.mime.startsWith("video/") ? "视频" : "图片"}: ${a.url}]`)
    .join(" ");
  const body = media ? `${m.content} ${media}`.trim() : m.content;
  return `[${hh}:${mm}] ${icon}${m.authorName}: ${body}`;
}
