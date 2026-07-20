import type { MessageAttachment } from "@club/shared";

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

  // Miss: parse once, cache only if the result is a real array.
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
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
