import type { ReactNode } from "react";
import type { Message, Participant } from "@club/shared";

// Default locale keeps the previous zh-CN behavior when a caller doesn't pass
// one (e.g. unit tests). Components pass the active locale from useI18n() so
// the rendered time/day follows the user's language choice.
const DEFAULT_LOCALE = "zh-CN";

// Regex patterns for inline code and fenced code blocks
const INLINE_CODE_RE = /`([^`]+)`/g;
const FENCED_CODE_RE = /```(\w*)\n([\s\S]*?)```/g;

export function fmtTime(ms: number, locale: string = DEFAULT_LOCALE): string {
  return new Date(ms).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// Full precision (HH:MM:SS) for the hover tooltip on a message — the inline
// timestamp only shows HH:MM to keep the row quiet; the exact second is there
// for anyone who hovers (or a SR user via the title/aria-label on the row).
export function fmtTimePrecise(ms: number, locale: string = DEFAULT_LOCALE): string {
  return new Date(ms).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// `todayLabel` lets the caller localize the "Today" separator without this
// module depending on the i18n dictionary. Falls back to the zh "今天".
export function fmtDay(
  ms: number,
  locale: string = DEFAULT_LOCALE,
  todayLabel: string = "今天",
): string {
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString()
    ? todayLabel
    : d.toLocaleDateString(locale, { month: "long", day: "numeric" });
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

// Render inline code span
function renderInlineCode(code: string, key: number): ReactNode {
  return (
    <code
      key={key}
      className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm text-foreground"
    >
      {code}
    </code>
  );
}

// Render fenced code block
function renderCodeBlock(code: string, key: number): ReactNode {
  return (
    <pre
      key={key}
      className="my-2 overflow-x-auto rounded-md bg-muted p-3 text-sm"
    >
      <code className="font-mono text-foreground">{code}</code>
    </pre>
  );
}

// Split content into text + highlighted @mention nodes + code blocks for known handles.
//
// Processing order: fenced code blocks → inline code → @mentions
// This ensures code blocks are not processed for @mentions inside them.
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
  let keyCounter = 0;

  // First, extract fenced code blocks
  const parts: Array<{ type: "text" | "fenced"; content: string }> = [];
  let remaining = content;
  let match: RegExpExecArray | null;

  FENCED_CODE_RE.lastIndex = 0;
  while ((match = FENCED_CODE_RE.exec(remaining)) !== null) {
    // Add text before code block
    if (match.index > 0) {
      parts.push({ type: "text", content: remaining.slice(0, match.index) });
    }
    // Add code block
    parts.push({
      type: "fenced",
      content: match[2],
    });
    remaining = remaining.slice(match.index + match[0].length);
    FENCED_CODE_RE.lastIndex = 0;
  }
  // Add remaining text
  if (remaining.length > 0) {
    parts.push({ type: "text", content: remaining });
  }

  // Process each part
  for (const part of parts) {
    if (part.type === "fenced") {
      out.push(renderCodeBlock(part.content, keyCounter++));
      continue;
    }

    // Process text part for inline code and mentions
    const textContent = part.content;

    // First, extract inline code
    const textParts: Array<{ type: "text" | "inline"; content: string }> = [];
    let textRemaining = textContent;
    INLINE_CODE_RE.lastIndex = 0;
    while ((match = INLINE_CODE_RE.exec(textRemaining)) !== null) {
      if (match.index > 0) {
        textParts.push({ type: "text", content: textRemaining.slice(0, match.index) });
      }
      textParts.push({ type: "inline", content: match[1] });
      textRemaining = textRemaining.slice(match.index + match[0].length);
      INLINE_CODE_RE.lastIndex = 0;
    }
    if (textRemaining.length > 0) {
      textParts.push({ type: "text", content: textRemaining });
    }

    // Process each text part for mentions
    for (const textPart of textParts) {
      if (textPart.type === "inline") {
        out.push(renderInlineCode(textPart.content, keyCounter++));
        continue;
      }

      // Process for @mentions
      let m: RegExpExecArray | null;
      let textLast = 0;
      MENTION_RE.lastIndex = 0;
      const mentionContent = textPart.content;
      while ((m = MENTION_RE.exec(mentionContent)) !== null) {
        if (m.index > textLast) {
          out.push(mentionContent.slice(textLast, m.index));
        }
        const handle = m[1];
        const isKnown = knownSet.has(handle.toLowerCase());
        const isSelf = selfLower != null && handle.toLowerCase() === selfLower;
        out.push(
          isKnown ? (
            isSelf ? (
              <mark
                key={keyCounter++}
                className="rounded border-l-2 border-primary bg-primary/25 px-1 font-medium text-primary"
              >
                @{handle}
              </mark>
            ) : (
              <mark key={keyCounter++} className="rounded bg-human-soft px-1 text-human">
                @{handle}
              </mark>
            )
          ) : (
            <span key={keyCounter++} className="text-foreground">
              @{handle}
            </span>
          ),
        );
        textLast = m.index + m[0].length;
      }
      if (textLast < mentionContent.length) {
        out.push(mentionContent.slice(textLast));
      }
    }
  }

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