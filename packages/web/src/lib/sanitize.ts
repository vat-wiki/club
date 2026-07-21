// Client-side sanitization for club/web.
//
// Defense in depth: the server sanitizes message content on ingestion
// (packages/shared sanitizeContent), but user-generated content still reaches
// the frontend in three untrusted vectors that bypass message-body sanitization:
//   1. Participant names (authorName, replyTo.authorName) — never pass through
//      message-content sanitization.
//   2. Quoted message bodies (replyTo.content) — the quoted blob comes from a
//      different message's content column and any future server change.
//   3. Corrupted / direct-written DB rows (backup restore, rogue migration).
//
// This module provides the web client with the same control-character stripping
// the server applies, so the UI is safe even when the server-side guard is
// bypassed. React's JSX escaping already prevents HTML injection, but invisible
// control bytes and CRLF still break visual layout, screen-reader output, and
// the virtualizer's row sizing.

/**
 * Strip ASCII control characters (U+0000..U+001F and U+007F DEL) from a
 * string. Mirrors the server's `sanitizeContent` contract so both sides
 * converge on the same safe text shape.
 *
 * Tabs and newlines are intentionally **not** stripped: `renderContent` uses
 * `whitespace-pre-wrap` and relies on real line breaks for multi-line messages.
 *
 * @param s - Raw user-generated text from the wire.
 * @returns The same string with control bytes removed.
 */
export function sanitizeDisplayString(s: string): string {
  if (typeof s !== "string") return "";
  // \x00-\x08, \x0b-\x0c, \x0e-\x1f, \x7f  (no \x09 tab, no \x0a/\x0d newline)
  return s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

/**
 * Cap display strings to a sane upper bound. Unbounded blobs (e.g. a server
 * bug dumping an entire file's bytes into a message body) would otherwise
 * crash the virtualizer's estimateSize calculation or make the whole list
 * unscrollable.
 *
 * The cap applies *after* control-character stripping, so both sanitizers
 * cooperate rather than competing.
 *
 * @param s - Already-sanitized (or raw) display string.
 * @param maxChars - Maximum characters to keep (default 10_000).
 * @param ellipsis - Marker appended when truncation occurs.
 * @returns The capped string.
 */
export function truncateDisplayString(
  s: string,
  maxChars = 10_000,
  ellipsis = "…",
): string {
  const sanitized = sanitizeDisplayString(s);
  if (sanitized.length <= maxChars) return sanitized;
  return sanitized.slice(0, maxChars) + ellipsis;
}
