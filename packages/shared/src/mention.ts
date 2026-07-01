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
 * "@走查-体验2". The leading `@` is itself the left boundary.
 *
 * `name` must be non-empty; callers own the empty-name case (the server skips
 * empty roster names, the CLI/MCP treat an empty filter as "match everything").
 * Pure + unit-tested.
 */
const NAME_CHAR = /[\p{L}\p{N}_-]/u;

export function mentionMatches(content: string, name: string): boolean {
  if (!name) return false;
  const needle = "@" + name.toLowerCase();
  const lower = content.toLowerCase();
  let i = lower.indexOf(needle);
  while (i !== -1) {
    const after = lower[i + needle.length];
    if (after === undefined || !NAME_CHAR.test(after)) return true;
    i = lower.indexOf(needle, i + needle.length);
  }
  return false;
}
