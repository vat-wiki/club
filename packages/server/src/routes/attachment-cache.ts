import type { MessageAttachment } from "@club/shared";

// Allowed MIME values — must mirror the shared `AttachmentMime` union so the
// server rejects a row whose mime is not in the agreed enum. Kept in sync with
// shared/types.ts; if the enum grows, add the value here too.
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/markdown",
]);

/**
 * Type guard: validate one attachment object has the required fields with the
 * correct JS types and an allowed mime.
 *
 * The server is the last line of defense: a rogue DB row (or a future direct
 * write) could store junk in the `attachments` column. Parsing it as
 * `MessageAttachment[]` without a guard would silently pass malformed data to
 * SSE consumers and the web frontend. This function turns a plain JSON object
 * into a typed attachment or rejects it.
 *
 * @param v - A parsed JSON value to test.
 * @returns True if `v` is a valid `MessageAttachment`.
 */
function isAttachment(v: unknown): v is MessageAttachment {
  if (v === null || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  if (typeof a.id !== "string") return false;
  if (typeof a.url !== "string") return false;
  if (typeof a.mime !== "string" || !ALLOWED_MIME.has(a.mime)) return false;
  if (typeof a.size !== "number") return false;
  // Optional fields may be absent; if present they must have the right type.
  if ("width" in a && typeof a.width !== "number") return false;
  if ("height" in a && typeof a.height !== "number") return false;
  if ("filename" in a && typeof a.filename !== "string") return false;
  return true;
}

/**
 * In-memory LRU cache for parsed attachment payloads.
 *
 * The attachment JSON string of a message is shared by many readers (the
 * list endpoint parses it on every row), so we parse once and cache the
 * array. A fixed-size LRU keeps unbounded history from blowing memory.
 */

const MAX_CACHE_SIZE = 512;
const cache = new Map<string, MessageAttachment[]>();

/**
 * Parse a raw attachment JSON string into an attachment array.
 *
 * Returns `undefined` when `raw` is null/empty, malformed JSON, or JSON that
 * isn't a non-empty array. Results are cached under the original raw string
 * with LRU eviction at a fixed bound.
 *
 * @param raw - Serialized attachment array, or `null`.
 * @returns The parsed attachment array, or `undefined` for no/corrupt data.
 */
export function parseAttachments(
  raw: string | null,
): MessageAttachment[] | undefined {
  // Fast path: null/empty → no attachments (no cache lookup needed).
  if (!raw) return undefined;

  // Promote on hit (Map preserves insertion order). Re-insert so the key
  // moves to the tail = most-recently-used, making the eviction step below
  // a true LRU rather than FIFO.
  const cached = cache.get(raw);
  if (cached !== undefined) {
    cache.delete(raw);
    cache.set(raw, cached);
    return cached;
  }

  // Miss: parse once, cache only if the result is a real array of valid
  // attachments. The runtime guard (isAttachment) prevents malformed rows
  // from poisoning the cache or leaking to SSE/SDK consumers.
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isAttachment)) {
      const arr = parsed as MessageAttachment[];
      cache.set(raw, arr);
      if (cache.size > MAX_CACHE_SIZE) {
        const firstKey = cache.keys().next().value;
        if (firstKey !== undefined) cache.delete(firstKey);
      }
      return arr;
    }
  } catch {
    // Malformed JSON → treat as no attachments (matches legacy behavior).
  }
  return undefined;
}

/**
 * Exposed only for tests: clear the LRU cache so individual tests don't
 * leak state into one another or hit `MAX_CACHE_SIZE` unexpectedly.
 */
export function clearAttachmentCache(): void {
  cache.clear();
}
