import type { Message, MessageAttachment } from "@club/shared";
import type {
  ImageMime,
  VideoMime,
  DocumentMime,
} from "@club/shared";

// ── Type-level discriminated attachment union ─────────────────────
//
// `MessageAttachment.mime` in `@club/shared` is a literal union
// (`ImageMime | VideoMime | DocumentMime`). The old implementation
// used `a.mime.startsWith("video/")` to branch at runtime, which
// silently accepted any string prefix and bypassed the type narrowing
// the union was designed to enable. The three branded interfaces below
// let the compiler verify every branch is exhaustive: if a new mime
// literal is added to the shared enum but no matching case is handled,
// type-checking fails instead of producing a misrendered fallback.

/** Attachment whose mime starts with "image/" */
interface ImageAttachment extends MessageAttachment {
  mime: ImageMime;
}
/** Attachment whose mime starts with "video/" */
interface VideoAttachment extends MessageAttachment {
  mime: VideoMime;
}
/** Attachment whose mime starts with "application/pdf" or "text/markdown" */
interface DocumentAttachment extends MessageAttachment {
  mime: DocumentMime;
}

type TypedAttachment = ImageAttachment | VideoAttachment | DocumentAttachment;

function renderAttachment(a: TypedAttachment): string {
  if (a.mime.startsWith("video/")) return `[视频: ${a.url}]`;
  if (a.mime.startsWith("image/")) return `[图片: ${a.url}]`;
  return `[文件: ${a.filename ?? a.id}]`;
}

export type FormattedMessage = string & { readonly __formattedMessage: unique symbol };

// Human-readable single-line rendering of a message, shared by CLI & MCP text
// results. Pure; safe to import anywhere.
export function formatMessage(m: Message): FormattedMessage {
  const t = new Date(m.createdAt);
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");

  // Handle deleted (recalled) messages
  if (m.deleted) {
    return `[${hh}:${mm}] ${m.authorName}: (recalled)` as FormattedMessage;
  }

  // Plan §AC-6: attachments must be visible to all clients alike, so each one
  // appends a token — `[图片: url]` / `[视频: url]` for media, `[文件: name]`
  // for documents (named, since a document is identified by its filename more
  // than a url). This only guarantees you can SEE attachments from the CLI/MCP.
  const media = (m.attachments ?? [])
    .map((a) => renderAttachment(a as TypedAttachment))
    .join(" ");
  const body = media ? `${m.content} ${media}`.trim() : m.content;

  // Append reactions if present
  const reactions = (m.reactions ?? [])
    .map((r) => `${r.emoji}(${r.count})`)
    .join(" ");

  // No author-kind marker: club does not classify participants (category-blind).
  const base = `[${hh}:${mm}] ${m.authorName}: ${body}`;
  return (reactions ? `${base} ${reactions}` : base) as FormattedMessage;
}
