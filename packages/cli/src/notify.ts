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
 * Structured outcome of a push attempt, so callers can surface *why* it
 * failed instead of a bare boolean. `reason` is a short, human-readable
 * diagnostic (HTTP status + target URL, or the network error name + URL)
 * suitable for stderr — it exists precisely because a bare `false` made
 * operational debugging ("503 from which daemon?") impossible.
 */
export type PushOutcome =
  | { ok: true }
  | { ok: false; reason: string };

/** Build a short diagnostic string from a thrown fetch error + target URL. */
function describeNetworkError(err: unknown, url: string): string {
  // Group the common Node fetch failure modes into readable labels. The DOM
  // Exception / TypeError names are stable across Node 20+; anything unknown
  // falls back to the error message so we never lose information.
  const name = (err as { name?: string } | null)?.name;
  let kind: string;
  if (name === "AbortError" || name === "TimeoutError") kind = "timeout";
  else if (name === "TypeError") kind = "network error (ECONNREFUSED / DNS / offline)";
  else kind = `${name ?? "error"}: ${(err as Error)?.message ?? String(err)}`;
  return `${kind} → ${url}`;
}

/**
 * Push a single club message to the notify-panel inbox, returning a detailed
 * outcome. This is the richer sibling of {@link pushMessage}: same best-effort
 * semantics (never throws), but on failure it carries a `reason` string so the
 * caller can print *which* failure (HTTP 503 vs timeout vs connection refused)
 * instead of an opaque "failed".
 *
 * Prefer this in new code (listen/mentions). {@link pushMessage} is kept for
 * back-compat with callers that only want the boolean.
 *
 * @returns `{ ok: true }` on HTTP 2xx, or `{ ok: false, reason }` on any
 * failure (non-2xx, network error, timeout, abort).
 */
export async function pushMessageDetailed(
  m: Message,
  conn: PushInput,
  opts: { meName?: string; severity?: "warning" | "info" } = {},
): Promise<PushOutcome> {
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
  const target = `${conn.url}/v1/notify`;
  try {
    const res = await fetch(target, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { ok: true };
    // Non-2xx: include status + a short excerpt of the body when it's JSON
    // (notify-panel's errorBody carries a message) so 503/400/etc. are
    // self-explanatory. Best-effort: a non-JSON or unreadable body degrades to
    // just the status code + URL.
    let detail = "";
    try {
      const text = await res.text();
      if (text) {
        // Try to extract notify-panel's {error/message} or a generic JSON
        // shape; fall back to the raw text truncated.
        try {
          const j = JSON.parse(text) as { message?: string; error?: string };
          detail = j.message ?? j.error ?? text.slice(0, 120);
        } catch {
          detail = text.slice(0, 120);
        }
      }
    } catch {
      /* body unreadable — status code is enough */
    }
    const reason = detail
      ? `HTTP ${res.status} (${detail}) → ${target}`
      : `HTTP ${res.status} → ${target}`;
    return { ok: false, reason };
  } catch (err) {
    return { ok: false, reason: describeNetworkError(err, target) };
  }
}

/**
 * Push a single club message to the notify-panel inbox.
 *
 * Thin back-compat wrapper around {@link pushMessageDetailed}: same best-effort
 * contract (never throws), but returns only the boolean. Callers that want to
 * surface the failure *reason* on stderr should use `pushMessageDetailed`
 * directly.
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
  return (await pushMessageDetailed(m, conn, opts)).ok;
}
