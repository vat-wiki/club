import type { SSEStreamingApi } from 'hono/streaming';
import type {
  Message,
  AgentThinkingEvent,
  AgentIdleEvent,
  PresenceEvent,
  MessageDeletedEvent,
  MessageReactionEvent,
} from '@club/shared';
// Subscriber registered at SSE connect time. `rooms` scopes which room-scoped
// events the stream receives (null = all rooms); `dead` marks a client whose
// SSE write failed so the fan-out loop can drop it in a single pass.
interface Subscriber {
  stream: SSEStreamingApi;
  participant: { id: string; name: string };
  rooms: Set<string> | null; // null = all rooms
  dead: boolean;
}

// Live SSE subscribers registered at connect time. The POST /messages route
// pushes new messages here; subscribers are removed on abort. Each carries the
// authed participant so presence (online/offline) can be broadcast on connect
// and disconnect, and a `rooms` filter so the stream can be scoped to one or
// more rooms (null = subscribed to all rooms).
const subscribers = new Set<Subscriber>();
// Does a subscriber want events for `room`? `room === null` marks an unscoped
// event (presence) that reaches every subscriber regardless of their filter —
// presence stays global by design (PRD §8.7: no per-room presence).
function wantsRoom(sub: Subscriber, room: string | null): boolean {
  if (room === null) return true;
  if (sub.rooms === null) return true;
  return sub.rooms.has(room);
}

// Register an SSE subscriber and announce their presence to the room. `rooms`
// scopes which room-scoped events this connection receives (null = all). Returns
// the unsubscribe fn (called on abort) which removes them and broadcasts
// offline. The newcomer is also seeded with everyone currently online so the
// roster can mark them live immediately rather than waiting for each to
// re-announce.
export function addSubscriber(
  s: SSEStreamingApi,
  participant: { id: string; name: string },
  rooms: Set<string> | null
): () => void {
  const entry = { stream: s, participant, rooms, dead: false };
  subscribers.add(entry);
  const presence = (p: typeof participant, online: boolean) => ({
    participantId: p.id,
    name: p.name,
    online,
  });
  // Announce the newcomer's own online status to every live subscriber (global
  // by design — presence is not room-scoped, PRD §8.7). writeAll handles
  // delivery to all subscribers; do not write other subscribers' presence into
  // the newcomer's own stream (the client never consumes those frames).
  broadcastPresence(presence(participant, true));
  return () => {
    entry.dead = true;
    subscribers.delete(entry);
    broadcastPresence(presence(entry.participant, false));
  };
}

// Push a named `presence` event (online/offline) to every live subscriber.
// Presence is intentionally NOT room-scoped (room === null → all subscribers).
export function broadcastPresence(e: PresenceEvent): void {
  writeAll({ event: 'presence', data: JSON.stringify(e) }, null);
}

// Push a named `message_deleted` event (recall). Clients mark the id recalled
// rather than dropping the row, so replies/context still read coherently.
export function broadcastDeleted(e: MessageDeletedEvent): void {
  writeAll({ event: 'message_deleted', data: JSON.stringify(e) }, e.room);
}

// Push a named `message_reaction` event (refreshed aggregate after a toggle).
export function broadcastReaction(e: MessageReactionEvent): void {
  writeAll({ event: 'message_reaction', data: JSON.stringify(e) }, e.room);
}

// Push a `message` event (the default, unnamed event in SSE). Backwards
// compatible: existing clients that parse only `data:` lines keep working.
export function broadcast(msg: Message): void {
  const payload = JSON.stringify(msg);
  writeAll({ data: payload }, msg.room);
}

// Push a named `agent_thinking` event. Uses the SSE `event:` field so a client
// branches on the event name; clients that don't know this event ignore it.
// When `e.room` is present the event is scoped to that room's subscribers;
// absent means an unscoped (legacy/global) report reaching everyone.
export function broadcastAgentThinking(e: AgentThinkingEvent): void {
  writeAll({ event: 'agent_thinking', data: JSON.stringify(e) }, e.room ?? null);
}

// Push a named `agent_idle` event. `e.room` scopes the clear to the same room
// the agent was thinking in; absent → unscoped (reaches everyone).
export function broadcastAgentIdle(e: AgentIdleEvent): void {
  writeAll({ event: 'agent_idle', data: JSON.stringify(e) }, e.room ?? null);
}

// Underlying fan-out: write one SSE frame to every live subscriber whose room
// filter matches `room` (null = unscoped event → everyone). Failures mark the
// subscriber dead and drop it. Collect dead subscribers synchronously in an
// array so the traversal of `subscribers` is not mutated concurrently; remove
// them after the loop in one pass. This avoids a subtle race where a later
// iteration would still see a subscriber that an earlier iteration's `.catch()`
// already marked dead but not yet removed.
//
// Performance: dead-collector uses a plain array with an early-return guard so
// we never allocate or iterate the dead-set on a clean broadcast where nothing
// died. (Note: the frame object is passed by reference per call — we cannot
// reuse a shared buffer because writeSSE reads the frame asynchronously, so
// every subscriber must get its own stable reference.)
function writeAll(
  frame: {
    event?: string;
    data: string;
  },
  room: string | null
): void {
  const dead: Subscriber[] = [];
  for (const sub of subscribers) {
    if (sub.dead) continue;
    if (!wantsRoom(sub, room)) continue;
    void sub.stream.writeSSE(frame).catch(() => {
      sub.dead = true;
      dead.push(sub);
    });
  }
  // Dead-cleanup only runs when something actually died; skip the loop entirely
  // on a clean broadcast.
  if (dead.length > 0) {
    for (const sub of dead) subscribers.delete(sub);
  }
}

// ── Agent thinking presence (P1-5) ───────────────────────────────────
//
// Who is currently "thinking". The source of truth for the typing indicator.
// Agents self-report via POST /agents/thinking|idle; the server adds two safety
// nets:
//   - reply-posted auto-clear: when an agent POSTs a message, markThinkingIdle
//     fires for that participant so the indicator can't stick on after a reply.
//   - TTL expiry: a reported thinking entry expires after THINKING_TTL_MS, so a
//     crashed / killed / silently-errored agent (one that never reports idle)
//     still clears the indicator. The reaper broadcasts agent_idle on expiry.
//
//   IMPORTANT: the TTL is a *lost-contact fallback*, NOT a "this is how long a
//   reply should take" timer. A healthy agent doing long work (e.g. a 90s LLM
//   round-trip) must re-report thinking periodically to refresh the TTL —
//   otherwise a legitimately slow reply would have its indicator yanked at TTL,
//   which is worse than a stale one. The MCP client does exactly this: it re-
//   reports on a ~THINKING_REFRESH_MS cadence while the agent is between a
//   matched listen and its send. The CLI listen-and-exit model can't re-report
//   (it process.exit()s on match), so for CLI the TTL alone is the budget; 45s
//   comfortably covers the typical match→send gap of an interactive agent.

const THINKING_TTL_MS = 45 * 1000; // ~45s — lost-contact fallback (not reply budget)

interface ThinkingEntry {
  participantId: string;
  name: string;
  // Room the agent reported thinking in, or null for an unscoped (legacy)
  // report. Carried onto the eventual `agent_idle` so the clear reaches the same
  // room-scoped subscribers that saw the indicator light up.
  room: string | null;
  expiresAt: number;
}

// participantId -> entry. One outstanding thinking state per agent: a second
// report while already thinking refreshes the TTL (an agent pinged again simply
// stays thinking, we don't double-broadcast).
const thinking = new Map<string, ThinkingEntry>();

/** Record (or refresh) that `participantId` is thinking. Returns whether this
 *  is a NEW entry (true) vs a TTL refresh of an existing one (false). Callers
 *  only broadcast `agent_thinking` on a fresh entry to avoid noisy re-broadcasts
 *  when an already-thinking agent is re-mentioned. `room` scopes the indicator
 *  to that room's stream when provided; null/omitted = unscoped (global). */
export function markThinking(
  participantId: string,
  name: string,
  room: string | null = null
): boolean {
  const fresh = !thinking.has(participantId);
  thinking.set(participantId, {
    participantId,
    name,
    room,
    expiresAt: Date.now() + THINKING_TTL_MS,
  });
  return fresh;
}

/** Clear the thinking state for `participantId`, returning the entry (so the
 *  caller can broadcast `agent_idle` into the right room) or null if it wasn't
 *  thinking. A redundant idle report is thus a no-op on the wire. */
export function markThinkingIdle(participantId: string): ThinkingEntry | null {
  const entry = thinking.get(participantId);
  if (!entry) return null;
  thinking.delete(participantId);
  return entry;
}

/** Is `participantId` currently in the thinking set? */
export function isThinking(participantId: string): boolean {
  return thinking.has(participantId);
}

// Reap expired thinking entries, broadcasting agent_idle for each so a dead
// agent's indicator can't get stuck on. Runs on the same heartbeat that pings
// idle SSE connections. The idle event carries the entry's room so the clear
// reaches the same room-scoped subscribers.
function reapExpiredThinking(): void {
  const now = Date.now();
  for (const [id, entry] of thinking) {
    if (entry.expiresAt <= now) {
      thinking.delete(id);
      broadcastAgentIdle({
        participantId: id,
        ...(entry.room ? { room: entry.room } : {}),
      });
    }
  }
}

// Keep idle connections warm, surface dead ones, and reap expired thinking
// state. One timer does double duty (no need for a second scheduler).
export const heartbeatInterval = setInterval(() => {
  if (subscribers.size === 0) return;
  const dead: Subscriber[] = [];
  for (const sub of subscribers) {
    if (sub.dead) {
      subscribers.delete(sub);
      continue;
    }
    void sub.stream
      .writeSSE({ data: '' }) // empty data line doubles as a heartbeat comment-safe ping
      .catch(() => {
        sub.dead = true;
        dead.push(sub);
      });
  }
  // Dead-cleanup only runs when at least one subscriber actually died.
  if (dead.length > 0) {
    for (const sub of dead) subscribers.delete(sub);
  }
  reapExpiredThinking();
}, 15000).unref();
