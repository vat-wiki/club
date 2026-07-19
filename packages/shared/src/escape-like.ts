/**
 * Escape `%`, `_` and backslash in a user-supplied LIKE substring so they
 * are treated literally rather than as LIKE wildcards.
 *
 * SQLite LIKE interprets `%` (any sequence), `_` (any single character),
 * and backslash (the default escape character) specially. Without escaping,
 * a search input like "%" would match every row in the database, and a
 * crafted value such as "_%" can leak data from unrelated messages.
 *
 * This function doubles backslashes first (so a literal `\` becomes `\\`),
 * then prefixes `%` and `_` with a single backslash. The caller must use
 * the `ESCAPE '\\'` clause with the resulting pattern — see
 * `searchMessages` in `db.ts`.
 */
export function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
