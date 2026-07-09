import type { SSEStreamingApi } from "hono/streaming";
import type { Message, AgentThinkingEvent, AgentIdleEvent, PresenceEvent, ParticipantKind } from "@club/shared";

// Live SSE subscribers registered at connect time. The POST /messages route
// pushes new messages here; subscribers are removed on abort. Each carries the
// authed participant so presence (online/offline) can be broadcast on connect
// and disconnect.
const subscribers = new Set<{
  stream: SSEStreamingApi;
  participant: { id: string; name: string; kind: ParticipantKind };
  dead: boolean;
}>();

// Register an SSE subscriber and announce their presence to the room. Returns
// the unsubscribe fn (called on abort) which removes them and broadcasts
// offline. The newcomer is also seeded with everyone currently online so the
// roster can mark them live immediately rather than waiting for each to
// re-announce.
export function addSubscriber(
  s: SSEStreamingApi,
  participant: { id: string; name: string; kind: ParticipantKind },
): () => void {
  const entry = { stream: s, participant, dead: false };
  subscribers.add(entry);
  const presence = (p: typeof participant, online: boolean) => ({
    participantId: p.id,
    name: p.name,
    kind: p.kind,
    online,
  });
  broadcastPresence(presence(participant, true));
  for (const sub of subscribers) {
    if (sub === entry || sub.dead) continue;
    void s
      .writeSSE({ event: "presence", data: JSON.stringify(presence(sub.participant, true)) })
      .catch(() => {});
  }
  return () => {
    entry.dead = true;
    subscribers.delete(entry);
    broadcastPresence(presence(entry.participant, false));
  };
}

// Push a named `presence` event (online/offline) to every live subscriber.
export function broadcastPresence(e: PresenceEvent): void {
  writeAll({ event: "presence", data: JSON.stringify(e) });
}

// Push a `message` event (the default, unnamed event in SSE). Backwards
// compatible: existing clients that parse only `data:` lines keep working.
export function broadcast(msg: Message): void {
  const payload = JSON.stringify(msg);
  writeAll({ data: payload });
}

// Push a named `agent_thinking` event. Uses the SSE `event:` field so a client
// branches on the event name; clients that don't know this event ignore it.
export function broadcastAgentThinking(e: AgentThinkingEvent): void {
  writeAll({ event: "agent_thinking", data: JSON.stringify(e) });
}

// Push a named `agent_idle` event.
export function broadcastAgentIdle(e: AgentIdleEvent): void {
  writeAll({ event: "agent_idle", data: JSON.stringify(e) });
}

// Underlying fan-out: write one SSE frame to every live subscriber. Failures
// mark the subscriber dead and drop it. Fire-and-forget per sub.
function writeAll(frame: {
  event?: string;
  data: string;
}): void {
  for (const sub of subscribers) {
    if (sub.dead) continue;
    // writeSSE returns a promise; fire-and-forget, drop on failure.
    void sub.stream
      .writeSSE(frame)
      .catch(() => {
        sub.dead = true;
        subscribers.delete(sub);
      });
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
  expiresAt: number;
}

// participantId -> entry. One outstanding thinking state per agent: a second
// report while already thinking refreshes the TTL (an agent pinged again simply
// stays thinking, we don't double-broadcast).
const thinking = new Map<string, ThinkingEntry>();

/** Record (or refresh) that `participantId` is thinking. Returns whether this
 *  is a NEW entry (true) vs a TTL refresh of an existing one (false). Callers
 *  only broadcast `agent_thinking` on a fresh entry to avoid noisy re-broadcasts
 *  when an already-thinking agent is re-mentioned. */
export function markThinking(participantId: string, name: string): boolean {
  const fresh = !thinking.has(participantId);
  thinking.set(participantId, {
    participantId,
    name,
    expiresAt: Date.now() + THINKING_TTL_MS,
  });
  return fresh;
}

/** Clear the thinking state for `participantId` and return whether it was
 *  present. Callers broadcast `agent_idle` only when something was actually
 *  cleared, so a redundant idle report is a no-op on the wire. */
export function markThinkingIdle(participantId: string): boolean {
  return thinking.delete(participantId);
}

/** Is `participantId` currently in the thinking set? Used by POST /messages to
 *  auto-clear an agent's indicator the moment its reply lands. */
export function isThinking(participantId: string): boolean {
  return thinking.has(participantId);
}

// Reap expired thinking entries, broadcasting agent_idle for each so a dead
// agent's indicator can't get stuck on. Runs on the same heartbeat that pings
// idle SSE connections.
function reapExpiredThinking(): void {
  const now = Date.now();
  for (const [id, entry] of thinking) {
    if (entry.expiresAt <= now) {
      thinking.delete(id);
      broadcastAgentIdle({ participantId: id });
    }
  }
}

// Keep idle connections warm, surface dead ones, and reap expired thinking
// state. One timer does double duty (no need for a second scheduler).
setInterval(() => {
  for (const sub of subscribers) {
    if (sub.dead) {
      subscribers.delete(sub);
      continue;
    }
    void sub.stream
      .writeSSE({ data: "" }) // empty data line doubles as a heartbeat comment-safe ping
      .catch(() => {
        sub.dead = true;
        subscribers.delete(sub);
      });
  }
  reapExpiredThinking();
}, 15000).unref();
