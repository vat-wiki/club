// Pure input-coercion helpers used by the MCP tool dispatcher.
//
// Kept side-effect-free and in their own module so they can be unit-tested in
// isolation: the server entry (index.ts) has top-level stdio side effects
// (resolveConn → process.exit, server.connect) that make importing it directly
// impractical from a test.

import type { Message, Participant } from "@club/shared";
import { formatMessage } from "@club/sdk";

/** Coerce an MCP tool argument to a string ("" if absent or not a string). */
export function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Coerce an MCP tool argument to a number, or undefined if not a number.
 * NOTE: intentionally passes NaN/±Infinity through unchanged — the `?? default`
 * at call sites only catches null/undefined, matching the original behavior.
 */
export function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

/**
 * Clamp a `limit` tool argument into the supported [1, 500] range.
 * Non-numbers and non-finite numbers (NaN / ±Infinity) fall back to the
 * default of 50, so a malformed argument can never yield NaN/Infinity.
 */
export function clampLimit(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 50;
  return Math.min(Math.max(1, Math.floor(n)), 500);
}

/**
 * Does `content` contain a @mention of `mention`?
 *
 * Mirrors the CLI `listen --mention` rule so a CLI agent and an MCP agent wake
 * on the same triggers: case-insensitive substring match on "@<name>". A
 * missing/empty `mention` matches every message (the `listen` "no filter" path).
 *
 * Pure + unit-tested; extracted from runListen so the matching rule — including
 * its intentional substring precision — is explicit and pinned by tests.
 */
export function matchesMention(
  content: string,
  mention: string | null | undefined,
): boolean {
  if (!mention) return true;
  return content.toLowerCase().includes("@" + mention.toLowerCase());
}

/** A stream subscription handle, as returned by ClubClient#stream. */
export type Subscribe = (onMessage: (m: Message) => void) => { stop: () => void };

/**
 * Run one `listen` cycle against an injected message stream: resolve with the
 * matched messages on the first @mention hit (or the first message, when no
 * mention is set), or with an empty array if nothing matches before timeoutMs.
 *
 * The only I/O is the injected `subscribe`, so this is unit-testable with a
 * fake stream + fake timers. Extracted from index.ts runListen so the listen
 * flow — first-match-returns, settled guard, timeout — is covered; behavior is
 * unchanged (the caller formats + wraps the result as before).
 */
export function listenForMatch(
  subscribe: Subscribe,
  mention: string | undefined,
  timeoutMs: number,
): Promise<Message[]> {
  return new Promise((resolve) => {
    const matched: Message[] = [];
    let settled = false;
    let handle: { stop: () => void } = { stop: () => {} };
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (settled) return;
      settled = true;
      handle.stop();
      if (timer) clearTimeout(timer);
      resolve(matched);
    };

    handle = subscribe((m) => {
      if (!matchesMention(m.content, mention)) return;
      matched.push(m);
      finish();
    });

    timer = setTimeout(finish, timeoutMs);
  });
}

// ── Tool dispatcher ───────────────────────────────────────────────────
// The subset of ClubClient the dispatcher touches. Declared as an interface
// (not `import type { ClubClient }`) so dispatchTool depends only on shape and
// can be exercised with a fake client — the real class is still structurally
// compatible. index.ts passes its real `client` instance straight through.
export interface DispatchClient {
  me(): Promise<Participant>;
  messages(opts: { since?: string; limit: number }): Promise<Message[]>;
  send(content: string): Promise<Message>;
  members(): Promise<Participant[]>;
  stream(onMessage: (m: Message) => void): { stop: () => void };
}

/**
 * Route one MCP tool call to the matching client action and return the
 * human-readable text the tool should reply with. Extracted from index.ts so
 * the dispatcher — every tool's formatting, empty-result, missing-arg, and
 * error behavior — is unit-testable with a fake client (importing index.ts
 * directly is impractical: it process.exit()s when CLUB_KEY is unset and binds
 * stdio at module top level).
 *
 * Throws when the underlying client call fails; index.ts wraps the throw as an
 * `error: <msg>` tool result, preserving the original behavior.
 */
export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  client: DispatchClient,
): Promise<string> {
  switch (name) {
    case "whoami": {
      const me = await client.me();
      return `You are ${me.name} (${me.kind}). id=${me.id}`;
    }
    case "read": {
      const limit = clampLimit(args.limit);
      const msgs = await client.messages({ since: str(args.since), limit });
      if (msgs.length === 0) return "(no messages)";
      return msgs.map(formatMessage).join("\n");
    }
    case "send": {
      const content = str(args.content);
      if (!content) return "error: missing content";
      const m = await client.send(content);
      return `sent: ${formatMessage(m)}`;
    }
    case "members": {
      const list = await client.members();
      if (list.length === 0) return "(no members)";
      return list.map((p) => `${p.kind === "agent" ? "🤖" : "🧑"}${p.name}`).join("\n");
    }
    case "listen": {
      const mention = str(args.mention) || undefined;
      const timeoutMs = num(args.timeoutMs) ?? 60000;
      const matched = await listenForMatch((cb) => client.stream(cb), mention, timeoutMs);
      return matched.length > 0
        ? matched.map(formatMessage).join("\n")
        : "(no matching messages within timeout)";
    }
    default:
      return `error: unknown tool "${name}"`;
  }
}
