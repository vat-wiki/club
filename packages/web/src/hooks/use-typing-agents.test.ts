import { act, renderHook } from "@testing-library/react";
import { describe, expect,it } from "vitest";

import { useTypingAgents } from "./use-typing-agents";

// Simulates the SDK dispatching the agent_thinking / agent_idle SSE named
// events to the hook's callbacks — the path useMessageStream forwards through
// StreamOptions.onAgentThinking / onAgentIdle. Proves the indicator set fills
// on thinking and clears on idle without depending on a live server.
describe("useTypingAgents", () => {
  it("adds an agent on agent_thinking and removes it on agent_idle", () => {
    const { result } = renderHook(() => useTypingAgents());

    expect(result.current.agents).toEqual([]);

    act(() => {
      result.current.onThinking({ participantId: "p1", name: "rex" });
    });
    expect(result.current.agents).toEqual([{ id: "p1", name: "rex" }]);

    act(() => {
      result.current.onIdle({ participantId: "p1" });
    });
    expect(result.current.agents).toEqual([]);
  });

  it("ignores duplicate thinking for the same agent and refreshes its name", () => {
    const { result } = renderHook(() => useTypingAgents());

    act(() => {
      result.current.onThinking({ participantId: "p1", name: "rex" });
    });
    act(() => {
      result.current.onThinking({ participantId: "p1", name: "Rex" });
    });
    expect(result.current.agents).toEqual([{ id: "p1", name: "Rex" }]);

    act(() => {
      result.current.onIdle({ participantId: "p1" });
    });
    expect(result.current.agents).toEqual([]);
  });

  it("tracks multiple agents independently", () => {
    const { result } = renderHook(() => useTypingAgents());

    act(() => {
      result.current.onThinking({ participantId: "p1", name: "rex" });
    });
    act(() => {
      result.current.onThinking({ participantId: "p2", name: "ana" });
    });
    expect(result.current.agents.map((a) => a.id)).toEqual(["p1", "p2"]);

    // Only one goes idle; the other stays.
    act(() => {
      result.current.onIdle({ participantId: "p1" });
    });
    expect(result.current.agents).toEqual([{ id: "p2", name: "ana" }]);
  });

  it("onIdle for an unknown id is a no-op", () => {
    const { result } = renderHook(() => useTypingAgents());
    act(() => {
      result.current.onIdle({ participantId: "ghost" });
    });
    expect(result.current.agents).toEqual([]);
  });

  it("never shows the viewer their own typing state (self-filter)", () => {
    // A human typing receives their own agent_thinking broadcast back (the
    // server fans out to all subscribers including the sender). The hook must
    // filter self out so you never see your own name in the indicator.
    const { result } = renderHook(() => useTypingAgents("me"));
    act(() => {
      result.current.onThinking({ participantId: "me", name: "myself" });
      result.current.onThinking({ participantId: "p1", name: "rex" });
    });
    expect(result.current.agents).toEqual([{ id: "p1", name: "rex" }]);
  });
});
