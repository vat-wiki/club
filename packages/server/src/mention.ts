import { mentionMatches } from "@club/shared";

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
 * `listen --mention <its-name>`. See `mentionMatches` for the word-boundary rule.
 */

export interface NamedParticipant {
  id: string;
  name: string;
}

/**
 * Return the roster entries that `content` @-mentions.
 *
 * Matching is delegated to @club/shared `mentionMatches` (word-boundary aware)
 * so the server's inbox agrees with the CLI/MCP live matchers. A name with an
 * empty string is skipped. Duplicate ids in the input are de-duplicated so a
 * participant is mentioned at most once per message.
 *
 * Pure and unit-tested; the caller (POST /messages) handles persistence.
 */
export function extractMentionedParticipants(
  content: string,
  roster: readonly NamedParticipant[],
): NamedParticipant[] {
  const seen = new Set<string>();
  const out: NamedParticipant[] = [];
  for (const p of roster) {
    if (!p.name) continue;
    if (seen.has(p.id)) continue;
    if (mentionMatches(content, p.name)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}
