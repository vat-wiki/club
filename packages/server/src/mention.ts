/**
 * Server-side @-mention parsing.
 *
 * This is the source of truth for "who got @-mentioned by a message" —
 * previously only the clients (CLI `listen --mention` and MCP `matchesMention`)
 * knew how to interpret `@<name>`, and the server just broadcast raw text. The
 * server now needs to know too, so it can persist per-participant inbox rows
 * that survive the recipient being offline.
 *
 * The actual match rule lives in @club/shared `mentionMatches` and is shared
 * with the client-side matchers (packages/mcp/src/helpers.ts `matchesMention`
 * and packages/cli/src/commands/listen.ts), so an agent that wakes from its
 * inbox sees exactly the messages it would have caught live via
 * `listen --mention <its-name>`. See `mentionMatches` for the word-boundary
 * rule.
 */

export interface NamedParticipant {
  id: string;
  name: string;
}

// Reuse the same character class that mentionMatches uses for word-boundary
// checks, so the server's single-pass scanner agrees exactly with the shared
// matcher. Keeping it here avoids pulling an implementation detail into the
// @club/shared library.
const NAME_CHAR = /[\p{L}\p{N}_-]/u;

/**
 * Single-pass scan of `content` to collect candidate mention strings.
 *
 * Walks the content once, advancing through each `@` occurrence and reading the
 * following NAME_CHAR run. Returns the set of lower-cased name strings that
 * appeared after an `@` and were followed by a word boundary (nothing or a
 * non-name char). This matches exactly what `mentionMatches` does — but in one
 * pass over the content rather than one pass per participant. For a 1000-char
 * message and 100 participants, this cuts work from ~100 full-content scans to
 * a single scan plus a Map lookup per candidate.
 */
function collectCandidateNames(content: string): Set<string> {
  const lower = content.toLowerCase();
  const candidates = new Set<string>();
  let i = lower.indexOf("@");
  while (i !== -1) {
    // `@` must not be preceded by a name character — avoid matching the `@` in
    // a plain email like "user@example.com" if the content were a raw address.
    // (Club messages never contain email-style `@` in practice, but being
    // strict here matches mentionMatches' intent.)
    if (i > 0 && NAME_CHAR.test(lower[i - 1])) {
      i = lower.indexOf("@", i + 1);
      continue;
    }
    let j = i + 1;
    while (j < lower.length && NAME_CHAR.test(lower[j])) j++;
    const name = lower.slice(i + 1, j);
    if (name.length > 0 && (j >= lower.length || !NAME_CHAR.test(lower[j]))) {
      candidates.add(name);
    }
    i = lower.indexOf("@", i + 1);
  }
  return candidates;
}

// Lazy cache of the name→participant Map. `extractMentionedParticipants` rebuilds
// it whenever the caller presents a roster reference that differs from the one
// the cache was built from. This is cheap: in production `getAllParticipantNames()`
// returns a stable cached array per process lifetime (only rebuilt on mutation),
// so the identity check hits on every message send after the first. On mutation
// both the db cache and this module cache are invalidated synchronously before
// any message can fire, so stale reads never happen.
const _cache = { roster: null as readonly NamedParticipant[] | null, map: new Map<string, NamedParticipant>() };

/**
 * Return the roster entries that `content` @-mentions.
 *
 * Matching is delegated to @club/shared `mentionMatches` (word-boundary aware)
 * so the server's inbox agrees with the CLI/MCP live matchers. A name with an
 * empty string is skipped. Duplicate ids in the input are de-duplicated so a
 * participant is mentioned at most once per message.
 *
 * Pure and unit-tested; the caller (POST /messages) handles persistence.
 *
 * Performance: the name→participant Map is built once per roster snapshot and
 * lazily cached via roster-reference identity. On the message-send hot path the
 * identity check succeeds every call (the caller's roster is stable), making
 * each invocation O(content length + number of @ occurrences) — one pass over
 * the content plus a Map lookup per candidate. No O(n_participants) Map rebuild
 * per message send.
 */
export function extractMentionedParticipants(
  content: string,
  roster: readonly NamedParticipant[],
): NamedParticipant[] {
  // Rebuild the cache only when the caller presents a different roster
  // reference. In production the roster snapshot is stable between mutations,
  // so this branch rarely fires on the hot path.
  if (roster !== _cache.roster) {
    _cache.roster = roster;
    _cache.map = new Map<string, NamedParticipant>();
    for (const p of roster) {
      const lower = p.name?.toLowerCase();
      if (lower && !_cache.map.has(lower)) {
        _cache.map.set(lower, p);
      }
    }
  }
  const byName = _cache.map;
  const seen = new Set<string>();
  const out: NamedParticipant[] = [];
  for (const candidate of collectCandidateNames(content)) {
    const p = byName.get(candidate);
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

/**
 * Invalidate the cached name→participant Map so the next call to
 * `extractMentionedParticipants` rebuilds it from the latest roster. Must be
 * called synchronously after every participant mutation (create/credential
 * rotation) — mirroring the `invalidateParticipantNamesCache` contract.
 */
export function invalidateParticipantNameMap(): void {
  _cache.roster = null;
  _cache.map.clear();
}
