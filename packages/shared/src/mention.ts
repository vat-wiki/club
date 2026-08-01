/**
 * Single source of truth for "does `content` @-mention `name`?".
 *
 * Shared by the server (per-participant mention inbox in
 * `extractMentionedParticipants`), the CLI (`listen --mention`), and the MCP
 * server (`matchesMention`) so that an agent woken from its inbox sees exactly
 * the messages it would have caught live via `listen --mention`. Previously each
 * of the three carried its own copy of the rule and had to be hand-kept in
 * lockstep; now they all call this.
 *
 * Rule: a case-insensitive match of `@<name>` that is NOT immediately followed
 * by another name character (letter / digit / underscore / hyphen, any script).
 * The trailing boundary stops a short name from matching a longer @-tag — e.g.
 * name "wang" is NOT mentioned by "@wangwen", and "走查-体验" is NOT mentioned by
 * "@走查-体验2". The `@` must also NOT be preceded by a name character, so a tag
 * glued to a word like "foo@alice" does not count - both boundaries mirror
 * collectCandidateNames in packages/server/src/mention.ts.
 *
 * `name` must be non-empty; callers own the empty-name case (the server skips
 * empty roster names, the CLI/MCP treat an empty filter as "match everything").
 * Pure + unit-tested.
 */
/** Regex matching a single name character (any letter, digit, underscore, or hyphen) */
const NAME_CHAR = /[\p{L}\p{N}_-]/u;

/**
 * Check if a message content @-mentions a participant by name.
 *
 * Single source of truth for "does `content` @-mention `name`?" Shared by
 * the server (per-participant mention inbox), the CLI (`listen --mention`),
 * and the MCP server (`matchesMention`).
 *
 * **Rule**: A case-insensitive match of `@<name>` that is NOT immediately
 * preceded or followed by another name character (letter/digit/underscore/hyphen,
 * any script). The trailing boundary stops a short name from matching a longer
 * @-tag — e.g. name "wang" is NOT mentioned by "@wangwen". The leading boundary
 * stops a tag glued to a word like "foo@alice" from counting; both boundaries
 * mirror collectCandidateNames in packages/server/src/mention.ts.
 *
 * @param content - The message content to search in
 * @param name - The participant name to check for (must be non-empty)
 * @returns true if the content contains a valid @-mention of the name
 *
 * @example
 * ```ts
 * mentionMatches("hey @alice", "alice");      // true
 * mentionMatches("hey @alice", "ALICE");       // true (case-insensitive)
 * mentionMatches("ping @alicia", "al");        // false (word boundary)
 * mentionMatches("foo@alice", "alice");       // false (leading boundary)
 * mentionMatches("alice will handle it", "alice"); // false (no @ prefix)
 * ```
 */
export function mentionMatches(content: string, name: string): boolean {
  if (!name) return false;
  const needle = "@" + name.toLowerCase();
  const lower = content.toLowerCase();
  let i = lower.indexOf(needle);
  while (i !== -1) {
    // Leading boundary: the `@` must not be preceded by a name character, so a
    // tag glued to a word like "foo@alice" is not treated as mentioning "alice".
    // This mirrors collectCandidateNames in packages/server/src/mention.ts; the
    // two must stay in lockstep so the server's inbox agrees with CLI/Web.
    if (i > 0 && NAME_CHAR.test(lower[i - 1])) {
      i = lower.indexOf(needle, i + needle.length);
      continue;
    }
    const after = lower[i + needle.length];
    if (after === undefined || !NAME_CHAR.test(after)) return true;
    i = lower.indexOf(needle, i + needle.length);
  }
  return false;
}
