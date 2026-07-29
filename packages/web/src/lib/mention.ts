import type { Participant } from "@club/shared";

/**
 * @-mention autocomplete helpers.
 *
 * All the non-React logic lives here as pure functions so it can be unit-tested
 * in isolation (see mention.test.ts) and reused. The Composer wires these into
 * textarea change/keydown handlers.
 *
 * Character class note: the server's mention parser
 * (packages/server/src/mention.ts `extractMentionedParticipants`) is a plain
 * case-insensitive substring match on `"@" + name` — it has no character-class
 * restriction and already supports CJK names like "王前端". The query token here
 * therefore accepts any non-whitespace character, so completing a Chinese name
 * produces a `@王前端` that the server will match. The frontend highlight regex
 * in format.tsx was widened to match (see comment there).
 */

// A mention query token: characters allowed after `@` while typing a handle.
// Whitespace ends the query (so "hi @bob " closes the popup); anything else,
// including CJK, is part of the handle.
const TOKEN_CHAR = /[^\s@]/;

export interface MentionQuery {
  /** Index in the full string where the `@` sits. */
  start: number;
  /** Index just past the last token char (i.e. where the caret is / token ends). */
  end: number;
  /** The query text without the leading `@` (may be ""). */
  query: string;
}

/**
 * Detect an active @-mention being typed at `caret` in `text`.
 *
 * Walks left from the caret looking for an `@`. The `@` only counts if it is at
 * the start of the text or preceded by whitespace (so an email like
 * `a@b.com` mid-token doesn't trigger). Returns null when there is no active
 * mention — including when a space was typed after the `@token` (that closes
 * the popup, matching Slack/Discord).
 *
 * Pure: (text, caret) -> MentionQuery | null.
 */
export function detectMention(text: string, caret: number): MentionQuery | null {
  if (caret < 1 || caret > text.length) return null;
  // Scan backwards from just before the caret for the trigger `@`.
  let i = caret - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === "@") {
      const prev = text[i - 1];
      // `@` must start the text or follow whitespace, otherwise it's part of a
      // larger token (e.g. the @ in an email address) and not a mention.
      if (i === 0 || /\s/.test(prev)) {
        const token = text.slice(i + 1, caret);
        // Token must be all TOKEN_CHAR (no embedded spaces). An empty token is
        // valid — that's the popup-just-opened state right after typing `@`.
        for (let t = 0; t < token.length; t++) {
          if (!TOKEN_CHAR.test(token[t])) return null;
        }
        return { start: i, end: caret, query: token };
      }
      return null;
    }
    // Hitting whitespace while scanning means there was no `@` in the current
    // token — no active mention.
    if (/\s/.test(ch)) return null;
    i--;
  }
  return null;
}

/**
 * Filter roster members by a mention query.
 *
 * Case-insensitive, fuzzy "contains" (not just prefix) so `@wang` matches
 * "王前端 (wang)" style handles and `@王` matches "王前端". The current user is
 * excluded — you don't @-mention yourself in a chat. Exact / prefix matches are
 * sorted before plain substring matches so the most relevant candidate lands
 * first.
 *
 * Pure: (query, members, selfId) -> Participant[].
 */
export function filterMembers(
  query: string,
  members: readonly Participant[],
  selfId?: string,
): Participant[] {
  const q = query.trim().toLowerCase();
  const out = members.filter((m) => {
    if (m.id === selfId) return false;
    if (!m.name) return false;
    return m.name.toLowerCase().includes(q);
  });
  // Stable-ish ordering: prefix match first, then contains; ties keep input order.
  out.sort((a, b) => {
    const pa = a.name.toLowerCase().startsWith(q) ? 0 : 1;
    const pb = b.name.toLowerCase().startsWith(q) ? 0 : 1;
    return pa - pb;
  });
  return out;
}

export interface MentionCompletion {
  /** New full text after splicing in the completion. */
  text: string;
  /** Caret index to place after the completion (after the trailing space). */
  caret: number;
}

/**
 * Compute the result of accepting `member` as the completion for the active
 * mention at `query` range in `text`.
 *
 * Replaces `text.slice(start, end)` (the `@` plus the typed query token) with
 * `@<member.name>` followed by a single trailing space, and positions the caret
 * right after that space so the user can keep typing their message.
 *
 * Pure: (text, query, name) -> MentionCompletion.
 */
export function applyMention(
  text: string,
  query: MentionQuery,
  name: string,
): MentionCompletion {
  const replacement = `@${name} `;
  const next = text.slice(0, query.start) + replacement + text.slice(query.end);
  return { text: next, caret: query.start + replacement.length };
}

/** Max candidates surfaced in the popup at once (the rest scroll). */
export const MENTION_MAX_VISIBLE = 8;
