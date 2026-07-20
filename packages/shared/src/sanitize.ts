/**
 * @module sanitize
 * Centralized sanitization of user-supplied text before it enters the
 * database or an SSE frame.
 *
 * Every byte the user provides ultimately becomes JSON data inside an SSE
 * frame (`data: <json>`), then travels back to clients on every live
 * subscriber. If raw ASCII control characters (\x00–\x1f, \x7f) are allowed
 * through, they break SSE framing, corrupt parsing in downstream tooling
 * (CLI/SDK/MCP), and let an attacker inject invisible delimiters that bypass
 * client-side display or search. Stripping them at the shared layer means
 * every ingestion path — direct API, SDK, CLI tunnel, MCP — is protected in
 * one place, and no future handler can accidentally re-introduce the gap.
 *
 * NOTE: \n and \r are *not* stripped. They are legitimate message content
 * (multi-line text, code blocks, stack traces) and the SSE layer JSON-encodes
 * them safely; only the single-byte control set that has no useful text
 * purpose is removed.
 *
 * @see id.ts — id-level validation (different axis: format, not character
 *           control).
 * @see rooms.ts requireValidRoomSlug — room slug validation.
 */

/**
 * Maximum length for a sanitized upload filename.
 *
 * Kept as a single constant so any future consumer (DB column width, API
 * schema, storage path) can stay in sync with the cap enforced at sanitization
 * time rather than hard-coding the same literal in multiple places.
 */
export const SANITIZED_FILENAME_MAX = 200;

/**
 * Sanitize an upload filename for storage.
 *
 * Performs the canonical three-step pipeline in one place:
 *   1. Keep only the basename (strip any path component).
 *   2. Remove ASCII control characters (\x00–\x1F, \x7F) so the header and
 *      downstream JSON parsing stay well-formed.
 *   3. Cap length to {@link SANITIZED_FILENAME_MAX}.
 *
 * Both the file-upload handler and {@link files.ts} / {@link contentDispositionFilename}
 * now call this function rather than re-implementing the same three-step
 * pipeline inline, so a future change to the rules is made once.
 *
 * @param filename - Raw, untrusted filename from the client.
 * @returns The sanitized basename, or `null` when the input is blank.
 *
 * @example
 *   sanitizeFilename("dir\\evil\x01name.bin") // "evilname.bin"
 *   sanitizeFilename("")                       // null
 */
export function sanitizeFilename(
  filename: string | null | undefined,
): string | null {
  if (filename == null || filename.trim() === "") return null;
  const cleaned = filename
    .split(/[\/\\]/)
    .pop()
    ?.replace(/[\x00-\x1F\x7F]/g, "")
    ?.slice(0, SANITIZED_FILENAME_MAX) ?? "";
  return cleaned.trim() === "" ? null : cleaned;
}

/**
 * Strip ASCII control characters from user-supplied message content so that
 * control-char injection cannot reach the DB or the SSE fan-out.
 *
 * Removes all single-byte ASCII control characters except TAB (\x09), LF
 * (\x0a), and CR (\x0d), which are legitimate in chat content (multi-line
 * text, code blocks). Preserves all Unicode graphemes including CJK and emoji.
 *
 * @param raw - Untrusted text from the client.
 * @returns The same text with ASCII control characters removed.
 *
 * @example
 *   sanitizeContent("hello\x00\x1fworld\n") // "helloworld\n"
 */
export function sanitizeContent(raw: string): string {
  // Range \x00-\x1f, *minus* the three bytes that can appear legitimately in
  // chat content: TAB (\x09), LF (\x0a), CR (\x0d). Vertical tab (\x0b) and
  // form feed (\x0c) are stripped (no chat purpose).
  return raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}
