import { useEffect, useRef, useState } from "react";
import { ClubClient, type ClubConn } from "@club/sdk";
import type { AgentThinkingEvent, AgentIdleEvent, Message } from "@club/shared";

type Status = "connecting" | "connected" | "lost";

export interface UseMessageStreamOptions {
  // Forwarded to ClubClient.stream so the typing indicator (P1-5) lights up
  // from the same SSE subscription as the message feed. Stable via refs below.
  onAgentThinking?: (e: AgentThinkingEvent) => void;
  onAgentIdle?: (e: AgentIdleEvent) => void;
}

// Live SSE subscription over the shared client. Reconnects with backoff when
// the stream ends on its own; tears down on unmount/key change. Returns the
// growing message tail (deduped by id) plus a connection status for the bar.
export function useMessageStream(
  conn: ClubConn | null,
  opts: UseMessageStreamOptions = {},
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<Status>("connecting");

  // keep a live ref so the append callback is stable across renders
  const appendRef = useRef((m: Message) => {
    setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
  });
  appendRef.current = (m: Message) => {
    setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
  };

  // Latest thinking/idle handlers via refs so the effect deps stay on `conn`
  // (we drive our own reconnect) while still calling the freshest callbacks.
  const thinkingRef = useRef(opts.onAgentThinking);
  thinkingRef.current = opts.onAgentThinking;
  const idleRef = useRef(opts.onAgentIdle);
  idleRef.current = opts.onAgentIdle;

  useEffect(() => {
    if (!conn) return;
    let stopped = false;
    let sub: { stop: () => void } | null = null;
    let reconnect: ReturnType<typeof setTimeout>;

    const connect = () => {
      if (stopped) return;
      setStatus("connecting");
      sub = new ClubClient(conn).stream(
        (m) => appendRef.current(m),
        {
          // The hook drives its own reconnect so it can track status; route the
          // drop notification through onError and disable the SDK's built-in
          // reconnect to keep this hook in control.
          reconnect: false,
          onError: () => {
            if (stopped) return;
            setStatus("lost");
            reconnect = setTimeout(connect, 3000);
          },
          onAgentThinking: (e) => thinkingRef.current?.(e),
          onAgentIdle: (e) => idleRef.current?.(e),
        },
      );
      setStatus("connected");
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(reconnect);
      sub?.stop();
    };
  }, [conn?.server, conn?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  return { messages, status, setMessages };
}