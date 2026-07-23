// notify-panel client — the single notification sink for platform messages.
//
// club CLI no longer prints received messages to stdout. Instead every message
// pulled from the platform (mentions via `club mentions`, live stream via
// `club listen`) is pushed into the local notify-panel inbox, so an agent has
// ONE place to "check inbox → act".
//
// notify-panel is a mandatory base dependency of club-cli. `ensureNotifyPanel()`
// (below) guarantees it is installed and running before any command that needs
// it; `pushMessage()` is the thin push wrapper used by listen/mentions.
//
// All operations are best-effort at the *push* level (a flaky daemon must never
// break message reception), but installation/daemon startup failures are made
// loud on stderr so the operator can fix the base dependency — silent loss of
// messages would defeat the whole point of the redirect.

import type { Message } from "@club/shared";
import { mentionMatches } from "@club/shared";

import { formatMessage } from "./commands/format.js";

/** notify-panel source tag for all club-originated notifications. */
export const NOTIFY_SOURCE = "club";

/** Title preview length: keep the inbox row scannable, full text goes in `message`. */
const TITLE_PREVIEW = 40;

/**
 * The severity to push a club message with.
 *
 * A message that @-mentions us is "needs attention" (warning); everything else
 * is informational context (info). Mirrors notify-panel's level semantics where
 * `warning` = "worth a look" and `info` = ambient.
 */
export function severityFor(message: Message, meName?: string): "warning" | "info" {
  if (meName && mentionMatches(message.content, meName)) return "warning";
  return "info";
}

/**
 * Build the notify-panel title for a message: `[@room] author: <preview>…`.
 *
 * Short and structured so it scans in the inbox list; the full single-line
 * rendering goes into the `message` body via {@link formatMessage}.
 */
export function titleFor(m: Message): string {
  const body = m.content.length > TITLE_PREVIEW
    ? `${m.content.slice(0, TITLE_PREVIEW)}…`
    : m.content;
  return `[@${m.room}] ${m.authorName}: ${body}`;
}

export interface PushInput {
  /** The notify-panel daemon base URL, e.g. `http://127.0.0.1:8787`. */
  url: string;
  /** Shared secret if the daemon requires one (omitted for localhost). */
  secret?: string;
}

/**
 * Push a single club message to the notify-panel inbox.
 *
 * Best-effort: any failure (daemon down, network, malformed response) resolves
 * to `false` rather than throwing — the caller (listen/mentions) must keep
 * working when the inbox is temporarily unreachable. A loud failure here would
 * break message reception, which is worse than a dropped notification.
 *
 * Severity is taken from `opts.severity` when given; otherwise derived from
 * whether the message @-mentions `opts.meName` (mention → warning, else info).
 *
 * @returns true on HTTP success, false on any failure.
 */
export async function pushMessage(
  m: Message,
  conn: PushInput,
  opts: { meName?: string; severity?: "warning" | "info" } = {},
): Promise<boolean> {
  const severity =
    opts.severity ?? (opts.meName && mentionMatches(m.content, opts.meName) ? "warning" : "info");
  const body = {
    source: NOTIFY_SOURCE,
    title: titleFor(m),
    message: formatMessage(m),
    severity,
  };
  const headers: Record<string, string> = { "content-type": "application/json" };
  // notify-panel uses a custom X-Notify-Secret header (not bearer auth) when the
  // daemon is exposed to the network; localhost needs none.
  if (conn.secret) headers["x-notify-secret"] = conn.secret;
  try {
    const res = await fetch(`${conn.url}/v1/notify`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
