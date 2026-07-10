import { assertImageCount } from "@club/sdk/node";

// Pure input-coercion helpers used by the MCP tool dispatcher.
//
// Kept side-effect-free and in their own module so they can be unit-tested in
// isolation: the server entry (index.ts) has top-level stdio side effects
// (resolveConn → process.exit, server.connect) that make importing it directly
// impractical from a test.

import { mentionMatches, type Message, type Participant, type Room } from "@club/shared";
import { formatMessage } from "@club/sdk";

/** Coerce an MCP tool argument to a string ("" if absent or not a string). */
export function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Coerce an MCP tool argument into a string[], tolerating the shapes an LLM
 * might send: a single string, or an array of strings. Anything else → [].
 * Used for the `send` tool's `images` parameter (a list of local file paths).
 */
export function strArray(v: unknown): string[] {
  if (typeof v === "string") return v.trim() ? [v] : [];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
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
 * Resolve the effective room for send/read: an explicit `room` arg wins, then
 * the CLUB_ROOM env var, then "general". This mirrors the CLI's flag → config
 * → general rule (PRD §5.4). Pure + exported so the fallback chain is tested.
 *
 * NOTE: this is for send/read only. `listen` defaults to ALL rooms (global) —
 * it does NOT fall back to CLUB_ROOM — so listen uses the raw `room` arg, not
 * this helper.
 */
export function resolveRoom(explicit: unknown, envRoom?: string): string {
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  if (typeof envRoom === "string" && envRoom.trim()) return envRoom.trim();
  return "general";
}

/**
 * Does `content` contain a @mention of `mention`?
 *
 * Delegates to @club/shared `mentionMatches` so an MCP agent wakes on exactly
 * the same triggers as the CLI `listen --mention` and the server's mention inbox
 * (single source of truth, word-boundary aware). A missing/empty `mention`
 * matches every message (the `listen` "no filter" path).
 *
 * Pure + unit-tested.
 */
export function matchesMention(
  content: string,
  mention: string | null | undefined,
): boolean {
  if (!mention) return true;
  return mentionMatches(content, mention);
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
  messages(opts: { since?: string; limit: number; room?: string }): Promise<Message[]>;
  send(content: string, attachmentIds?: string[], opts?: { room?: string }): Promise<Message>;
  /** Upload one local image file, returning its attachment descriptor.
   *  Index.ts wires this to @club/sdk uploadImageFile (read→sniff→validate→
   *  POST /files); declared on the interface so dispatchTool stays fakeable. */
  uploadImage(path: string): Promise<{ id: string }>;
  members(): Promise<Participant[]>;
  /** GET /rooms — every room, general first then most-recently-active first. */
  rooms(): Promise<Room[]>;
  stream(
    onMessage: (m: Message) => void,
    opts?: { room?: string },
  ): { stop: () => void };
  /** Report that THIS agent started processing (lights up the room's typing
   *  indicator). Agent-only; no-op-equivalent (404) for a human key. Pass
   *  `room` to scope the indicator to that room's stream. The matching idle is
   *  auto-cleared by the server when this agent's reply lands (POST /messages),
   *  so callers don't need a paired reportAgentIdle in the common
   *  send-after-listen path. */
  reportAgentThinking(room?: string): Promise<void>;
}

// ── Thinking heartbeat (TTL refresh) ──────────────────────────────────
//
// The server's thinking TTL (~45s) is a lost-contact fallback, NOT a "this is
// how long a reply should take" timer. An MCP agent doing long work between a
// matched `listen` and its `send` (e.g. a 90s LLM round-trip across multiple
// tool-call rounds) would otherwise see its indicator yanked at TTL — which is
// worse than a stale one. So once a listen matches, we re-report thinking on a
// cadence comfortably shorter than the TTL to keep refreshing it. The server
// dedupes re-reports (no re-broadcast), so this only nudges expiresAt forward;
// the indicator never flickers. The heartbeat is stopped when the agent's reply
// lands (send → server auto-clears thinking) or superseded by the next listen.
//
// Module-level on purpose: the "thinking" state belongs to THIS agent process,
// which is single-threaded across tool calls (MCP is sync request/response).
const THINKING_REFRESH_MS = 15 * 1000; // re-report well inside the 45s TTL
let thinkingHeartbeat: ReturnType<typeof setInterval> | undefined;

function startThinkingHeartbeat(client: DispatchClient, room?: string): void {
  stopThinkingHeartbeat();
  thinkingHeartbeat = setInterval(() => {
    void client.reportAgentThinking(room).catch(() => {
      /* nicety, not correctness — same swallow as the initial report */
    });
  }, THINKING_REFRESH_MS).unref?.();
}

function stopThinkingHeartbeat(): void {
  if (thinkingHeartbeat) {
    clearInterval(thinkingHeartbeat);
    thinkingHeartbeat = undefined;
  }
}

// Test-only export: clear the module-level heartbeat between tests so a prior
// listen's heartbeat never leaks into the next one. Not part of the dispatcher
// API surface; exported only so the suite can reset shared state.
export const __test = { stopThinkingHeartbeat, THINKING_REFRESH_MS };

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
      // send/read default to CLUB_ROOM → general (PRD §5.4). listen is the only
      // one that defaults to all rooms — it does NOT use resolveRoom.
      const room = resolveRoom(args.room, process.env.CLUB_ROOM);
      const msgs = await client.messages({ since: str(args.since), limit, room });
      if (msgs.length === 0) return "(no messages)";
      return msgs.map(formatMessage).join("\n");
    }
    case "send": {
      const content = str(args.content);
      const images = strArray(args.images);
      // Need at least one of: text or images. A bare image is a legitimate
      // intent ("text-optional"), mirroring the CLI and web.
      if (!content && images.length === 0) return "error: missing content";
      // Fail fast on too many images before any upload happens.
      assertImageCount(images);
      const room = resolveRoom(args.room, process.env.CLUB_ROOM);
      let attachmentIds: string[] | undefined;
      if (images.length > 0) {
        // Pre-flight + upload each image; an unsupported/missing/too-large file
        // throws and index.ts surfaces it as `error: <msg>`.
        const ids: string[] = [];
        for (const p of images) {
          const att = await client.uploadImage(p);
          ids.push(att.id);
        }
        attachmentIds = ids;
      }
      const m = await client.send(content, attachmentIds, { room });
      // The reply just landed — the server auto-clears our thinking state on
      // POST /messages, so the heartbeat has nothing left to refresh. Stop it
      // so we don't keep re-lighting an indicator for a turn that's over.
      stopThinkingHeartbeat();
      return `sent: ${formatMessage(m)}`;
    }
    case "members": {
      const list = await client.members();
      if (list.length === 0) return "(no members)";
      return list.map((p) => `${p.kind === "agent" ? "🤖" : "🧑"}${p.name}`).join("\n");
    }
    case "rooms": {
      const list = await client.rooms();
      if (list.length === 0) return "(no rooms)";
      // One room per line; general flagged as the system room. Mirrors the CLI
      // `club rooms` output shape so an agent reading either sees the same
      // information.
      return list
        .map((r) => `#${r.slug}${r.slug === "general" ? " (system)" : ""}`)
        .join("\n");
    }
    case "listen": {
      const mention = str(args.mention) || undefined;
      // listen's room is a pure scoping filter: omit → all rooms (global). It
      // deliberately does NOT fall back to CLUB_ROOM (PRD §5.4 / §5.5) — a
      // dispatcher agent must hear a @mention from any room by default.
      const room = str(args.room) || undefined;
      const timeoutMs = num(args.timeoutMs) ?? 60000;
      const matched = await listenForMatch(
        (cb) => client.stream(cb, room ? { room } : {}),
        mention,
        timeoutMs,
      );
      if (matched.length > 0) {
        // The agent just got handed a message it's about to act on — light up
        // the typing indicator in the room the match came from (m.room), so a
        // focused stream sees it. Falls back to the explicit `room` arg when
        // present; otherwise unscoped (legacy global indicator). We then START
        // A HEARTBEAT that re-reports thinking every THINKING_REFRESH_MS until
        // this agent's reply lands (send → server auto-clears) or the next
        // listen supersedes it. Why: the server's ~45s thinking TTL is a
        // *lost-contact fallback*, so a legitimately slow reply (long LLM
        // round-trip across multiple tool rounds) would otherwise drop the
        // indicator mid-thought. Re-reporting only refreshes the server's TTL —
        // the SSE event is deduped, so the indicator never flickers.
        const thinkRoom = matched[0]?.room ?? room;
        try {
          await client.reportAgentThinking(thinkRoom);
          startThinkingHeartbeat(client, thinkRoom);
        } catch {
          /* non-fatal: the indicator is a nicety, not correctness */
        }
      }
      return matched.length > 0
        ? matched.map(formatMessage).join("\n")
        : "(no matching messages within timeout)";
    }
    default:
      return `error: unknown tool "${name}"`;
  }
}
