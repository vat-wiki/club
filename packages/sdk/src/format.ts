import type { Message } from "@club/shared";

// Human-readable single-line rendering of a message, shared by CLI & MCP text
// results. Pure; safe to import anywhere.
export function formatMessage(m: Message): string {
  const t = new Date(m.createdAt);
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  const icon = m.authorKind === "agent" ? "🤖" : "🧑";
  return `[${hh}:${mm}] ${icon}${m.authorName}: ${m.content}`;
}
