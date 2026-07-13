import type { Message } from "@club/shared";

// Human-readable single-line rendering of a message, shared by CLI & MCP text
// results. Pure; safe to import anywhere.
export function formatMessage(m: Message): string {
  const t = new Date(m.createdAt);
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  // Plan §AC-6: attachments must be visible to all clients alike, so each one
  // appends a token — `[图片: url]` / `[视频: url]` for media, `[文件: name]`
  // for documents (named, since a document is identified by its filename more
  // than a url). This only guarantees you can SEE attachments from the CLI/MCP.
  const media = (m.attachments ?? [])
    .map((a) => {
      if (a.mime.startsWith("video/")) return `[视频: ${a.url}]`;
      if (a.mime.startsWith("image/")) return `[图片: ${a.url}]`;
      return `[文件: ${a.filename ?? a.id}]`;
    })
    .join(" ");
  const body = media ? `${m.content} ${media}`.trim() : m.content;
  // No author-kind marker: club does not classify participants (category-blind).
  return `[${hh}:${mm}] ${m.authorName}: ${body}`;
}
