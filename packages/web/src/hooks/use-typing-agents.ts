import { useCallback, useState } from "react";
import type { AgentThinkingEvent, AgentIdleEvent } from "@club/shared";
import type { TypingAgent } from "@/components/typing-indicator";

// useTypingAgents — the SINGLE integration point for the agent "thinking"
// indicator (P1-5). Drives the live list of agents currently processing a
// message/@mention. The SDK parses the `agent_thinking` / `agent_idle` SSE
// named events and dispatches them to the callbacks returned here; wire those
// callbacks into ClubClient.stream()'s StreamOptions.
//
// Semantics:
//   - agent_thinking → add/refresh the agent in the set (id keyed).
//   - agent_idle     → remove the agent from the set.
// The server guarantees an idle is always emitted on reply/error/offline and
// also runs a TTL reaper as a backstop, so the indicator can't get stuck on.
// We deliberately do NOT hard-code the TTL value here (it lives on the server
// and is being tuned independently).
//
// The hook lives separately from useMessageStream so the message feed and the
// typing state can evolve independently.
export function useTypingAgents(): {
  agents: readonly TypingAgent[];
  onThinking: (e: AgentThinkingEvent) => void;
  onIdle: (e: AgentIdleEvent) => void;
} {
  const [agents, setAgents] = useState<TypingAgent[]>([]);

  const onThinking = useCallback((e: AgentThinkingEvent) => {
    const next: TypingAgent = { id: e.participantId, name: e.name };
    setAgents((prev) =>
      prev.some((a) => a.id === next.id)
        ? prev.map((a) => (a.id === next.id ? next : a))
        : [...prev, next],
    );
  }, []);

  const onIdle = useCallback((e: AgentIdleEvent) => {
    const id = e.participantId;
    setAgents((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return { agents, onThinking, onIdle };
}
