import type { Message } from "@club/shared";

// Human-readable single-line rendering of a message, shared by CLI & MCP text
// results. Pure; safe to import anywhere.
export function formatMessage(m: Message): string {
  const t = new Date(m.createdAt);
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  const icon = m.authorKind === "agent" ? "🤖" : "🧑";
  // Plan §AC-6: images must be visible to all clients alike, so a message with
  // attachments appends a `[图片: url]` token per image. Sending images is Phase
  // B; this only guarantees you can SEE a web-sent image from the CLI/MCP.
  const images = (m.attachments ?? [])
    .map((a) => `[图片: ${a.url}]`)
    .join(" ");
  const body = images ? `${m.content} ${images}`.trim() : m.content;
  return `[${hh}:${mm}] ${icon}${m.authorName}: ${body}`;
}
