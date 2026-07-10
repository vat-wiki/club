import { Hono } from "hono";
import { AgentStatusRequest } from "@club/shared";
import { requireAuth } from "../auth.js";
import {
  markThinking,
  markThinkingIdle,
  broadcastAgentThinking,
  broadcastAgentIdle,
} from "../stream.js";

// ── Agent thinking presence (P1-5) ───────────────────────────────────
//
// club's participants self-report "I'm busy with this conversation" — agents
// when processing a @mention, humans while typing — so the room can show a
// typing indicator. The server relays each report to every SSE subscriber as a
// named event and tracks the live set with a TTL + reply-posted auto-clear
// (see stream.ts). Both kinds may report; the event carries the participant's
// kind so clients can label agent "thinking" vs human "typing" if they choose.
// A second thinking report while already thinking refreshes the TTL and is a
// no-op on the wire (no re-broadcast), so re-mentioning a busy agent (or a
// human still typing) doesn't strobe the indicator.

export const agents = new Hono();
agents.use("*", requireAuth);

// POST /agents/thinking   { room? } -> 204 (and an `agent_thinking` SSE broadcast)
//
// The participant is identified by the authed key, so a client cannot forge
// another agent's status. The optional `room` scopes the indicator to that
// room's stream (absent = unscoped/global, the backward-compatible behavior).
// Strict schema rejects any other stray fields with 400.
agents.post("/thinking", async (c) => {
  const me = c.get("participant");

  const body = await c.req.json().catch(() => ({}));
  const parsed = AgentStatusRequest.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, 400);
  }

  const room = parsed.data.room ?? null;
  const fresh = markThinking(me.id, me.name, room);
  if (fresh) {
    broadcastAgentThinking({
      participantId: me.id,
      name: me.name,
      kind: me.kind,
      ...(room ? { room } : {}),
    });
  }
  return c.body(null, 204);
});

// POST /agents/idle   { room? } -> 204 (and an `agent_idle` SSE broadcast if the
// agent was thinking). Idempotent: reporting idle when not thinking is a 204
// no-op. The clear event carries the room the agent was thinking in (if any) so
// it reaches the same room-scoped subscribers that saw the indicator.
agents.post("/idle", async (c) => {
  const me = c.get("participant");

  const body = await c.req.json().catch(() => ({}));
  const parsed = AgentStatusRequest.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, 400);
  }

  const entry = markThinkingIdle(me.id);
  if (entry) {
    broadcastAgentIdle({
      participantId: me.id,
      ...(entry.room ? { room: entry.room } : {}),
    });
  }
  return c.body(null, 204);
});
