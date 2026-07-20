/**
 * Centralized id validation for route-level params.
 *
 * Club IDs are either ULIDs (26 chars, uppercase base32) or short random
 * base64url slugs. In both cases they contain no path separators, whitespace,
 * or traversal tokens. This validator is the single guard a route handler
 * applies to any id-bearing param before it reaches the DB or the filesystem.
 *
 * - Message IDs (DELETE /messages/:id, /:id/reactions) — ULIDs
 * - Mention IDs (POST /me/mentions/:id/read) — ULIDs
 * - File IDs (GET /files/:id) — base64url random slugs (also guarded again by
 *   `filePath()` on disk, but this catches malformed ids before they leave the
 *   route layer, so the filesystem guard never has to handle garbage input).
 *
 * SQL injection is already impossible (all queries use prepared statements with
 * bound parameters), but an early rejection of obviously bogus ids keeps DB
 * round-trips off the critical path and produces a clean 400 in audit logs.
 */
export const ID_REGEX = /^[A-Za-z0-9_-]+$/;

export function isValidId(id: string): boolean {
  return ID_REGEX.test(id);
}
