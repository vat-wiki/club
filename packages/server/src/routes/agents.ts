import { Hono } from "hono";

import { AgentStatusRequest } from "@club/shared";

import { requireAuth } from "../auth.js";
import { parseJsonBody } from "../lib.js";
import { requireJson } from "../lib/json-content-type.js";
import {
  broadcastAgentIdle,
  broadcastAgentThinking,
  markThinking,
  markThinkingIdle,
} from "../stream.js";

// ── Agent Presence & Typing Indicators ─────────────────────────────────
//
// club's participants self-report "I'm busy with this conversation" — an agent
// processing a @mention, a human typing — so the channel can show a typing
// indicator. The server relays each report to every SSE subscriber as a named
// event and tracks the live set with a TTL + reply-posted auto-clear (see
// stream.ts). The mechanism is category-blind: any participant may report, and
// the event carries no kind (club does not classify participants — see
// .pd-docs/requirements/category-blind.md). A second report while already
// thinking refreshes the TTL and is a no-op on the wire (no re-broadcast), so
// re-mentioning a busy participant doesn't strobe the indicator.

export const agents = new Hono();
agents.use("*", requireAuth);

// POST /agents/thinking   { channel? } -> 204 (and an `agent_thinking` SSE broadcast)
//
// Lights up the typing/thinking indicator for the authenticated participant.
//
// The optional `channel` parameter scopes the indicator to that channel's stream:
// - With channel: only subscribers to that channel see the indicator
// - Without channel: all subscribers see it (legacy/global behavior)
//
// Security: The participant is identified by the authed key, so a client cannot
// forge another agent's status. The strict schema rejects extra fields with 400.
//
// Idempotent: Re-reporting while already thinking refreshes the TTL without
// re-broadcasting (no indicator strobe).
//
// Agent-only: Human keys get 404 (they have no use for this endpoint).
agents.post("/thinking", requireJson, async (c) => {
  const me = c.get("participant");

  const parsed = await parseJsonBody(c, AgentStatusRequest, "bad request");
  if (!parsed.ok) return parsed.r;
  const channel = parsed.data.channel ?? null;
  const fresh = markThinking(me.id, me.name, channel);
  if (fresh) {
    broadcastAgentThinking({
      participantId: me.id,
      name: me.name,
      ...(channel ? { channel } : {}),
    });
  }
  return c.body(null, 204);
});

// POST /agents/idle   { channel? } -> 204 (and an `agent_idle` SSE broadcast if the
// agent was thinking)
//
// Manually clears the typing/thinking indicator. Usually NOT needed — the server
// auto-clears when the agent posts a reply (POST /messages). Use this endpoint
// only when:
// - Your agent aborts work without sending a message (e.g., due to an error)
// - You want to explicitly signal "done" before sending (rare)
//
// Idempotent: Reporting idle when not thinking is a 204 no-op.
//
// The clear event carries the channel the agent was thinking in (if any) so it
// reaches the same channel-scoped subscribers that saw the indicator.
//
// Security: Same as /thinking — the authed key identifies the participant.
agents.post("/idle", requireJson, (c) => {
  const me = c.get("participant");

  // markThinkingIdle is synchronous — calling it through await Promise.resolve
  // would force the handler onto a microtask, delaying the SSE broadcast by one
  // event-loop turn for no benefit. Keep it inline so the response is immediate.
  const entry = markThinkingIdle(me.id);
  if (entry) {
    broadcastAgentIdle({
      participantId: me.id,
      ...(entry.channel ? { channel: entry.channel } : {}),
    });
  }
  return c.body(null, 204);
});
