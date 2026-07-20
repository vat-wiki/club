/**
 * @module @club/sdk/stream
 *
 * Real-time message streaming via Server-Sent Events (SSE).
 *
 * `streamMessages()` opens a long-lived connection to `GET /messages/stream` and
 * dispatches typed callbacks for incoming messages and lifecycle events
 * (agent thinking, presence, deletions, reactions). When the connection drops it
 * automatically reconnects with exponential jittered backoff, then fetches any
 * messages missed during the outage via `GET /messages?since=<lastId>` —
 * de-duplicating by ulid-based message id so overlap between the live buffer
 * and the catch-up query is delivered exactly once.
 *
 * Room scope: pass a single `room` or a `rooms[]` array to subscribe to only
 * those rooms; omit both for an all-rooms stream. Catch-up queries mirror the
 * same scope so a multi-room client never silently drops from rooms it doesn't
 * re-fetch.
 *
 * All callbacks are optional — subscribe only to the events you care about.
 *
 * @example
 * ```ts
 * import { streamMessages } from "@club/sdk";
 * import { ClubClient } from "@club/sdk";
 *
 * const client = new ClubClient({ server: "https://club.example" });
 * const { stop } = streamMessages(
 *   client,        // a ClubConn-compatible connection
 *   (m) => console.log("new:", m.id, m.content), // onMessage
 *   { reconnect: true, onPresence, onError: (e) => console.warn(e) },
 * );
 * // later …
 * stop(); // tears down the SSE connection and cancels reconnect
 * ```
 */

import type { Message, AgentThinkingEvent, AgentIdleEvent, PresenceEvent, MessageDeletedEvent, MessageReactionEvent } from "@club/shared";
import { jitteredBackoff, sleep } from "@club/shared";
import { type ClubConn, listMessages, listRooms } from "./transport.js";

// ── Runtime type guards for SSE payloads ─────────────────────────────
// Bare JSON.parse() casts ("as T") give no safety against malformed or
// spoofed server payloads. These guards narrow unknown → concrete types
// at runtime so the type system and runtime agree, and malformed events
// fail safely instead of corrupting downstream state (e.g. deliver()
// crashing on m.id <= lastId with an untyped object).

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

function isAgentThinkingEvent(v: unknown): v is AgentThinkingEvent {
  if (!isObj(v)) return false;
  if (typeof v.participantId !== "string" || typeof v.name !== "string") return false;
  return v.room === undefined || typeof v.room === "string";
}

function isAgentIdleEvent(v: unknown): v is AgentIdleEvent {
  if (!isObj(v)) return false;
  if (typeof v.participantId !== "string") return false;
  return v.room === undefined || typeof v.room === "string";
}

function isPresenceEvent(v: unknown): v is PresenceEvent {
  if (!isObj(v)) return false;
  if (typeof v.participantId !== "string" || typeof v.name !== "string") return false;
  if (typeof v.online !== "boolean") return false;
  return true;
}

function isMessageDeletedEvent(v: unknown): v is MessageDeletedEvent {
  if (!isObj(v)) return false;
  return typeof v.id === "string" && typeof v.room === "string";
}

function isReaction(v: unknown): v is { emoji: string; count: number } {
  return isObj(v) && typeof v.emoji === "string" && typeof v.count === "number";
}

function isMessageReactionEvent(v: unknown): v is MessageReactionEvent {
  if (!isObj(v)) return false;
  if (typeof v.messageId !== "string" || typeof v.room !== "string") return false;
  if (!Array.isArray(v.reactions)) return false;
  return v.reactions.every(isReaction);
}

function isMessage(v: unknown): v is Message {
  if (!isObj(v)) return false;
  if (typeof v.id !== "string" || typeof v.participantId !== "string") return false;
  if (typeof v.authorName !== "string" || typeof v.content !== "string") return false;
  if (typeof v.createdAt !== "number" || typeof v.room !== "string") return false;
  if (v.attachments !== undefined && !Array.isArray(v.attachments)) return false;
  if (v.replyToId !== undefined && typeof v.replyToId !== "string") return false;
  if (v.deleted !== undefined && typeof v.deleted !== "boolean") return false;
  if (v.reactions !== undefined && !Array.isArray(v.reactions)) return false;
  if (v.status !== undefined && v.status !== "sending" && v.status !== "failed") return false;
  return true;
}

// ── SSE streaming with reconnect + catch-up ─────────────────────────

export interface StreamOptions {
  /**
   * Reconnect automatically when the stream drops (default true).
   *
   * When false, any network error terminates the stream immediately and fires
   * `onError` one last time. Useful when the caller wants to drive its own
   * retry logic.
   */
  reconnect?: boolean;
  /**
   * Max reconnect attempts before giving up (default Infinity — keep trying).
   *
   * Set to 1 to retry once then stop; set to 0 to give up immediately (equivalent
   * to `reconnect: false` for errors after the first connection is established).
   */
  maxReconnects?: number;
  /**
   * Base backoff ms for reconnect (default 500; exponential, jittered, capped 15s).
   *
   * The actual delay grows as `min(base * 2^attempt, 15000)` with ±20% random
   * jitter, so a persistent failure quickly settles at a slow retry cadence
   * without hammering the server.
   */
  backoffMs?: number;
  /**
   * Notified on stream errors and on each reconnect attempt.
   *
   * Receives `Error` objects. Note that this is *also* called before each
   * reconnect attempt, so callers should be prepared for repeated calls during
   * a flaky network.
   */
  onError?: (err: Error) => void;
  /** Fired for each `agent_thinking` event (P1-5). Omit to ignore. */
  onAgentThinking?: (e: AgentThinkingEvent) => void;
  /** Fired for each `agent_idle` event (P1-5). Omit to ignore. */
  onAgentIdle?: (e: AgentIdleEvent) => void;
  /** Fired for each `presence` event (online/offline). Omit to ignore. */
  onPresence?: (e: PresenceEvent) => void;
  /** Fired when a message is recalled (`message_deleted` event). */
  onMessageDeleted?: (e: MessageDeletedEvent) => void;
  /** Fired when a reaction is toggled (`message_reaction` event). */
  onReaction?: (e: MessageReactionEvent) => void;
  /** Subscribe to a single room only (room-scoped stream). */
  room?: string;
  /** Subscribe to multiple rooms. Ignored if `room` is set. */
  rooms?: string[];
}

export interface StreamHandle {
  /** Stop the stream and tear down the current connection. Idempotent. */
  stop: () => void;
}

const RECONNECT_CAP_MS = 15_000;

/** Subscribe to /messages/stream. onMessage fires for each event. The stream
 * reconnects on drop and catches up on anything missed while disconnected
 * (fetched via GET /messages?since=<lastId>), de-duplicating by message id so
 * overlap between the live buffer and the catch-up query is delivered exactly
 * once. Returns a stop() handle.
 *
 * @param c - A ClubConn-compatible connection (any object with `{ server, key }`).
 * @param onMessage - Called with each new or catch-up message in chronological
 *   order. Already-seen messages (id ≤ the highest id previously delivered)
 *   are silently skipped.
 * @param opts - Optional configuration. Defaults: `reconnect: true`,
 *   `maxReconnects: Infinity`, `backoffMs: 500`.
 * @returns A handle with a `stop()` method that aborts the current SSE
 *   connection and cancels any pending reconnect.
 *
 * @throws {Error} When the server responds with an HTTP error or when the SSE
 *   frame size exceeds 1 MB (broken or hostile server).
 * @throws {AbortError} Propagated from the underlying fetch when `stop()`
 *   aborts an in-flight request.
 *
 * @remarks
 * The stream is subscribe-first: the SSE connection is opened *before*
 * catch-up runs, so any messages broadcast during catch-up are already in
 * the live buffer. The id-based de-dup in `deliver()` then collapses any
 * overlap to exactly-once delivery.
 *
 * Catch-up for an all-rooms subscription is best-effort: if room enumeration
 * fails the catch-up is skipped and the reopened live stream covers the gap.
 *
 * @example
 * ```ts
 * const { stop } = streamMessages(conn, (m) => render(m), { room: "general" });
 * // later: stop();
 * ```
 */
export function streamMessages(
  c: ClubConn,
  onMessage: (m: Message) => void,
  opts: StreamOptions = {},
): StreamHandle {
  const reconnect = opts.reconnect ?? true;
  const maxReconnects = opts.maxReconnects ?? Infinity;
  const base = opts.backoffMs ?? 500;

  // Room filter for the stream: a single room, a set of rooms, or null = all.
  // Drives both the /messages/stream?room=|?rooms= query and the catch-up
  // fetches (which must mirror the subscription scope, else a multi-room client
  // would only catch up general on reconnect).
  const roomFilter: string[] | null = opts.room
    ? [opts.room]
    : opts.rooms && opts.rooms.length > 0
      ? opts.rooms
      : null;
  const roomQuery = opts.room
    ? `room=${encodeURIComponent(opts.room)}`
    : opts.rooms && opts.rooms.length > 0
      ? `rooms=${opts.rooms.map(encodeURIComponent).join(",")}`
      : "";

  // One abort signal for the whole subscription lifetime; stop() aborts it,
  // which cuts the reconnect backoff short and tears down the live fetch.
  const stopSignal = new AbortController();
  let fetchController: AbortController | null = null;
  // Highest message id seen. ulid ids are lexicographically monotonic, so this
  // doubles as a "resume cursor" for catch-up and a de-dup bound.
  let lastId: string | undefined;

  void loop();

  async function loop(): Promise<void> {
    let attempts = 0;
    while (!stopSignal.signal.aborted) {
      try {
        await openStream();
        attempts = 0; // healthy connection resets the backoff window
      } catch (err) {
        if (stopSignal.signal.aborted) return;
        const err2 = err instanceof Error ? err : new Error(String(err));
        if (!reconnect || attempts >= maxReconnects) {
          opts.onError?.(err2);
          return;
        }
        opts.onError?.(err2);
        await sleep(jitteredBackoff(attempts, base, RECONNECT_CAP_MS), stopSignal.signal);
        if (stopSignal.signal.aborted) return;
        attempts++;
      }
    }
  }

  // Open the SSE connection and start reading frames. Throws on HTTP error
  // and on frames larger than 1 MB (broken or hostile server).
  async function openStream(): Promise<void> {
    fetchController = new AbortController();
    // If stop() fires mid-connection, abort the in-flight fetch too.
    stopSignal.signal.addEventListener(
      "abort",
      () => fetchController?.abort(),
      { once: true },
    );
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (c.key) headers.Authorization = `Bearer ${c.key}`;
    const res = await fetch(
      `${c.server}/messages/stream${roomQuery ? "?" + roomQuery : ""}`,
      {
        headers,
        signal: fetchController.signal,
      },
    );
    if (!res.ok || !res.body) throw new Error(`stream failed: HTTP ${res.status}`);

    // Subscribe-first: the SSE connection is now live, so anything broadcast
    // during catch-up lands in its buffer. Catch up on the gap (if any); the
    // id-based de-dup in deliver() collapses any overlap to exactly-once.
    await catchUp();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    // Defensive: protect against malformed servers sending unbounded frame data.
    // A frame larger than this likely indicates a broken implementation or abuse.
    const MAX_FRAME_SIZE = 1_000_000; // 1MB per SSE frame
    while (!stopSignal.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // Guard against buffer overflow from a malicious or broken server.
      if (buf.length > MAX_FRAME_SIZE) {
        throw new Error("SSE frame exceeded maximum size (1MB); disconnecting");
      }
      let sep: number;
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const raw = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        // An SSE frame may carry an `event:` line (named event) and one or more
        // `data:` lines. Split into the event name (default "message") and the
        // joined data payload, then dispatch by name. Unknown event names are
        // ignored — forward-compatible with future named events.
        let eventName = "message";
        const dataLines: string[] = [];
        for (const line of raw.split("\n")) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
          }
        }
        if (dataLines.length === 0) continue; // heartbeat/empty
        const payload = dataLines.join("\n");
        if (payload === "") continue;
        try {
          const obj = JSON.parse(payload);
          // Runtime type guard on every branch: narrow unknown → concrete type
          // rather than casting blindly. Malformed payloads are silently dropped
          // (forward-compatible, safe under a broken or hostile server).
          if (eventName === "agent_thinking" && isAgentThinkingEvent(obj)) {
            opts.onAgentThinking?.(obj);
          } else if (eventName === "agent_idle" && isAgentIdleEvent(obj)) {
            opts.onAgentIdle?.(obj);
          } else if (eventName === "presence" && isPresenceEvent(obj)) {
            opts.onPresence?.(obj);
          } else if (eventName === "message_deleted" && isMessageDeletedEvent(obj)) {
            opts.onMessageDeleted?.(obj);
          } else if (eventName === "message_reaction" && isMessageReactionEvent(obj)) {
            opts.onReaction?.(obj);
          } else if (eventName === "message" && isMessage(obj)) {
            // The default SSE event (no `event:` line) — the original feed.
            deliver(obj);
          }
          // Any other named event (or a type-mismatch) is ignored — forward-
          // compatible with future events the client doesn't yet know about.
        } catch {
          /* ignore malformed */
        }
      }
    }
    if (!stopSignal.signal.aborted) throw new Error("stream ended");
  }

  // Push a message to the onMessage callback if it's strictly newer than
  // anything already seen. ulid ids are lexicographically monotonic, so a
  // simple string comparison is a valid ordering.
  function deliver(m: Message): void {
    // De-dup: skip anything at or before the resume cursor (catch-up overlap).
    if (lastId !== undefined && m.id <= lastId) return;
    lastId = m.id;
    onMessage(m);
  }

  // Fetch any messages missed while the stream was disconnected, scoped to
  // the same room filter as the SSE connection. For an all-rooms
  // subscription the room list is enumerated best-effort; if that fails the
  // catch-up is silently skipped (the reopened live stream covers the gap).
  async function catchUp(): Promise<void> {
    if (lastId === undefined) return; // nothing to resume from
    // Catch up the gap per subscribed room: GET /messages is single-room, so a
    // multi-room subscription fetches each room's new-since-cursor messages.
    // ulid ids are globally monotonic, so the id-based de-dup in deliver()
    // collapses any overlap to exactly-once and lastId advances correctly
    // across rooms. For an all-rooms subscription we first enumerate rooms
    // (best-effort — a failure just skips catch-up, the live stream covers it).
    let rooms: string[];
    if (roomFilter !== null) {
      rooms = roomFilter;
    } else {
      try {
        rooms = (await listRooms(c)).map((r) => r.slug);
      } catch {
        return;
      }
    }
    for (const room of rooms) {
      try {
        const missed = await listMessages(c, { since: lastId, room });
        for (const m of missed) deliver(m);
      } catch {
        /* best-effort; the reopened stream keeps delivering live messages */
      }
    }
  }

  return {
    stop: () => {
      stopSignal.abort();
      fetchController?.abort();
    },
  };
}
