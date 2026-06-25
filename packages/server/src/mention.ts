/**
 * Server-side @-mention parsing.
 *
 * This is the source of truth for "who got @-mentioned by a message" —
 * previously only the clients (CLI `listen --mention` and MCP `matchesMention`)
 * knew how to interpret `@<name>`, and the server just broadcast raw text. The
 * server now needs to know too, so it can persist per-participant inbox rows
 * that survive the recipient being offline.
 *
 * Semantics are deliberately aligned with the client-side matcher
 * (packages/mcp/src/helpers.ts `matchesMention` and
 * packages/cli/src/commands/listen.ts): a case-insensitive substring match on
 * `"@" + name`. A change here MUST stay in lockstep with those two — an agent
 * that wakes from its inbox should see exactly the messages it would have
 * caught live via `listen --mention <its-name>`.
 */

export interface NamedParticipant {
  id: string;
  name: string;
}

/**
 * Return the roster entries that `content` @-mentions.
 *
 * Case-insensitive substring match on `"@" + name`, mirroring the client-side
 * rule. A name with an empty string is skipped (it would match any "@" in the
 * text). Duplicate ids in the input are de-duplicated so a participant is
 * mentioned at most once per message.
 *
 * Pure and unit-tested; the caller (POST /messages) handles persistence.
 */
export function extractMentionedParticipants(
  content: string,
  roster: readonly NamedParticipant[],
): NamedParticipant[] {
  const lower = content.toLowerCase();
  const seen = new Set<string>();
  const out: NamedParticipant[] = [];
  for (const p of roster) {
    if (!p.name) continue;
    if (seen.has(p.id)) continue;
    if (lower.includes("@" + p.name.toLowerCase())) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}
