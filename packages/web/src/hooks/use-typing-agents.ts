import { useCallback, useState } from "react";
import type { AgentThinkingEvent, AgentIdleEvent } from "@club/shared";
import type { TypingAgent } from "@/components/typing-indicator";

// useTypingAgents — the SINGLE integration point for the typing indicator
// (P1-5). Drives the live list of participants currently composing a reply (an
// agent processing a @mention OR a human typing). The SDK parses the
// `agent_thinking` / `agent_idle` SSE named events and dispatches them to the
// callbacks returned here; wire those callbacks into ClubClient.stream()'s
// StreamOptions.
//
// Semantics:
//   - agent_thinking → add/refresh the participant in the set (id keyed).
//   - agent_idle     → remove the participant from the set.
// The server guarantees an idle is always emitted on reply/error/offline and
// also runs a TTL reaper as a backstop, so the indicator can't get stuck on.
// We deliberately do NOT hard-code the TTL value here (it lives on the server
// and is being tuned independently).
//
// `selfId` filters the viewer out: you never see your own "typing" indicator,
// only everyone else's. (Without this, a human typing would see their own name
// in the indicator, since the server broadcasts to all subscribers including
// the sender.)
//
// The hook lives separately from useMessageStream so the message feed and the
// typing state can evolve independently.
export function useTypingAgents(selfId?: string): {
  agents: readonly TypingAgent[];
  onThinking: (e: AgentThinkingEvent) => void;
  onIdle: (e: AgentIdleEvent) => void;
} {
  const [agents, setAgents] = useState<TypingAgent[]>([]);

  const onThinking = useCallback((e: AgentThinkingEvent) => {
    // Never show the viewer their own typing state.
    if (e.participantId === selfId) return;
    const next: TypingAgent = { id: e.participantId, name: e.name };
    setAgents((prev) =>
      prev.some((a) => a.id === next.id)
        ? prev.map((a) => (a.id === next.id ? next : a))
        : [...prev, next],
    );
  }, [selfId]);

  const onIdle = useCallback((e: AgentIdleEvent) => {
    const id = e.participantId;
    setAgents((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return { agents, onThinking, onIdle };
}
