import type { ReactNode } from "react";
import type { Message, Participant } from "@club/shared";

export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function fmtDay(ms: number): string {
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString()
    ? "today"
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// Highlight a `@handle`. The token is "one or more letters / digits / underscore
// / hyphen", covering any script (including CJK) via Unicode property escapes —
// wider than the previous ASCII-only `[A-Za-z0-9_-]+`, which failed to highlight
// CJK agent names like "王前端".
//
// This is a display-only regex; it does NOT have to match the server's mention
// parser. The server (packages/server/src/mention.ts
// `extractMentionedParticipants`) uses a case-insensitive substring match on
// `"@" + name` with no character-class restriction, so a `@王前端` typed by the
// user is already matched end-to-end for persistence/inbox. This regex only
// decides which `@...` spans get the highlighted `<mark>` in the rendered
// bubble; we widen it so the highlight matches what the server already
// recognizes. `known` (built from the roster) gates whether a span is styled as
// a known mention vs plain text, so widening the charset can't produce false
// highlights for non-roster text. Trailing punctuation (`!`, `,`) is naturally
// excluded because it isn't a letter/digit/underscore/hyphen.
const MENTION_RE = /@([\p{L}\p{N}_-]+)/gu;

// Split content into text + highlighted @mention nodes for known handles.
//
// `selfName` (optional): when a known @handle matches the current user
// (case-insensitive), it is rendered with the brand/primary palette instead of
// the amber "other mention" color, so a user can instantly see "this message
// pings me" at a glance. Contrast is tuned to stay ≥ 4.5:1 (mint is light, so
// we pair `bg-primary/25` with `text-primary` + `font-medium` to clear AA on
// the graphite background).
export function renderContent(
  content: string,
  known: string[],
  selfName?: string,
): ReactNode[] {
  const knownSet = new Set(known.map((n) => n.toLowerCase()));
  const selfLower = selfName?.toLowerCase();
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(content)) !== null) {
    if (m.index > last) out.push(content.slice(last, m.index));
    const handle = m[1];
    const isKnown = knownSet.has(handle.toLowerCase());
    const isSelf = selfLower != null && handle.toLowerCase() === selfLower;
    out.push(
      isKnown ? (
        isSelf ? (
          <mark
            key={m.index}
            className="rounded border-l-2 border-primary bg-primary/25 px-1 font-medium text-primary"
          >
            @{handle}
          </mark>
        ) : (
          <mark key={m.index} className="rounded bg-human-soft px-1 text-human">
            @{handle}
          </mark>
        )
      ) : (
        <span key={m.index} className="text-foreground">
          @{handle}
        </span>
      ),
    );
    last = m.index + m[0].length;
  }
  if (last < content.length) out.push(content.slice(last));
  return out;
}

// Cheap substring check used by MessageRow to decide whether a row visually
// flags "this mentions the current user" (row-level signal that complements
// the inline self-mention highlight). Case-insensitive to match the server's
// mention parser semantics. Pure so it can be unit-tested directly.
export function mentionsSelf(content: string, selfName?: string): boolean {
  if (!selfName) return false;
  return content.toLowerCase().includes("@" + selfName.toLowerCase());
}

export type { Message, Participant };