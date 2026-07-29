import type { Message, MessageAttachment } from "@vatwiki/shared";
import type {
  DocumentMime,
  ImageMime,
  VideoMime,
} from "@vatwiki/shared";

// ── Type-level discriminated attachment union ─────────────────────
//
// `MessageAttachment.mime` in `@vatwiki/shared` is a literal union
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

function renderAttachment(a: TypedAttachment, server?: string): string {
  if (a.mime.startsWith("video/")) return `[视频: ${absoluteUrl(a.url, server)}]`;
  if (a.mime.startsWith("image/")) return `[图片: ${absoluteUrl(a.url, server)}]`;
  // Documents surface both the filename (what it is) and the URL (where to fetch
  // it) when a server base is provided, so an agent reading `club read` output
  // gets a fully-usable download link without a second `club cat` round-trip.
  const name = a.filename ?? a.id;
  const link = absoluteUrl(a.url, server);
  return server ? `[文件: ${name} | ${link}]` : `[文件: ${name}]`;
}

/**
 * Resolve an attachment url to an absolute one when a server base is given.
 * - No server → return as-is (legacy/relative behavior, back-comat).
 * - Already absolute (http(s)://) → return as-is (idempotent).
 * - Relative → prepend server (normalized for trailing/leading slashes).
 */
function absoluteUrl(url: string, server?: string): string {
  if (!server) return url;
  if (/^https?:\/\//i.test(url)) return url;
  const base = server.replace(/\/+$/, "");
  return url.startsWith("/") ? `${base}${url}` : `${base}/${url}`;
}

export type FormattedMessage = string & { readonly __formattedMessage: unique symbol };

/** Options for {@link formatMessage}. */
export interface FormatMessageOptions {
  /**
   * Server base URL (e.g. `https://club.example`). When provided, attachment
   * URLs in the rendered line are resolved to absolute URLs so a consumer
   * (agent, script) gets a directly-usable download link without a second
   * `club cat` round-trip. Omit for the legacy relative-path behavior.
   */
  server?: string;
}

// Human-readable single-line rendering of a message, shared by CLI & MCP text
// results. Pure; safe to import anywhere.
//
// `opts.server`, when provided, makes attachment URLs absolute in the output
// (see {@link FormatMessageOptions.server}).
export function formatMessage(
  m: Message,
  opts: FormatMessageOptions = {},
): FormattedMessage {
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
  // With `opts.server`, urls become absolute so an agent reading the output
  // gets a fetch-ready link inline.
  const media = (m.attachments ?? [])
    .map((a) => renderAttachment(a as TypedAttachment, opts.server))
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
