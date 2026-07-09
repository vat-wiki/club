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

// POST /agents/thinking   {} -> 204 (and an `agent_thinking` SSE broadcast)
//
// Body is intentionally empty: the participant is identified by the authed key,
// so a client cannot forge another agent's status. Strict schema rejects any
// stray fields with 400 rather than silently accepting a malformed contract.
agents.post("/thinking", async (c) => {
  const me = c.get("participant");

  const body = await c.req.json().catch(() => ({}));
  const parsed = AgentStatusRequest.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, 400);
  }

  const fresh = markThinking(me.id, me.name);
  if (fresh) broadcastAgentThinking({ participantId: me.id, name: me.name, kind: me.kind });
  return c.body(null, 204);
});

// POST /agents/idle   {} -> 204 (and an `agent_idle` SSE broadcast if the agent
// was thinking). Idempotent: reporting idle when not thinking is a 204 no-op,
// so an agent that double-reports (e.g. on both reply and exit) doesn't error.
agents.post("/idle", async (c) => {
  const me = c.get("participant");

  const body = await c.req.json().catch(() => ({}));
  const parsed = AgentStatusRequest.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, 400);
  }

  const wasThinking = markThinkingIdle(me.id);
  if (wasThinking) broadcastAgentIdle({ participantId: me.id });
  return c.body(null, 204);
});
