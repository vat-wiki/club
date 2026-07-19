/**
 * Escape `%`, `_` and backslash in a user-supplied LIKE substring so they
 * are treated literally rather than as LIKE wildcards.
 *
 * SQLite treats `%` (any sequence) and `_` (any single character) as
 * wildcards in LIKE. Without escaping a search input like "%" would match
 * every row in the database, and a crafted value such as "_%" can leak
 * data from unrelated messages.
 */
export const SEARCH_WILDCARD_ESCAPE = /[%_\\]/g;

export function escapeLike(value: string): string {
  return value.replace(SEARCH_WILDCARD_ESCAPE, (ch) => `\\${ch}`);
}
