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

const MENTION_RE = /@([A-Za-z0-9_-]+)/g;

// Split content into text + highlighted @mention nodes for known handles.
export function renderContent(content: string, known: string[]): ReactNode[] {
  const knownSet = new Set(known.map((n) => n.toLowerCase()));
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(content)) !== null) {
    if (m.index > last) out.push(content.slice(last, m.index));
    const handle = m[1];
    const isKnown = knownSet.has(handle.toLowerCase());
    out.push(
      isKnown ? (
        <mark key={m.index} className="rounded bg-human-soft px-1 text-human">
          @{handle}
        </mark>
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

export type { Message, Participant };