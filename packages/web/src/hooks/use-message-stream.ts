import { useCallback, useEffect, useRef, useState } from "react";
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
  const [loadingMore, setLoadingMore] = useState(false);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());

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
          onPresence: (e) => {
            setOnlineIds((prev) => {
              const next = new Set(prev);
              if (e.online) next.add(e.participantId);
              else next.delete(e.participantId);
              return next;
            });
          },
        },
      );
      setStatus("connected");
    };

    hasMoreRef.current = true;
    setOnlineIds(new Set());
    connect();
    return () => {
      stopped = true;
      clearTimeout(reconnect);
      sub?.stop();
    };
  }, [conn?.server, conn?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live ref of the current tail so loadMore can read the oldest id without
  // becoming a dep of the callback (which would re-create it on every message).
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  // Assume older history exists until a `before` fetch returns empty — keeps
  // the UI from hammering the server once we've scrolled to the top of the room.
  const hasMoreRef = useRef(true);

  // Load one page of older history (scroll-up pagination). Prepends anything
  // new, de-duped by id. Returns whether it actually loaded anything, so the
  // caller can preserve scroll position only when the list grew.
  const loadMore = useCallback(async (): Promise<boolean> => {
    if (!conn || loadingMore) return false;
    const prev = messagesRef.current;
    if (prev.length === 0) return false;
    const oldest = prev[0];
    // A pending optimistic echo has no server history before it; skip until it
    // resolves into a real id.
    if (oldest.id.startsWith("optimist-")) return false;
    if (!hasMoreRef.current) return false;
    setLoadingMore(true);
    try {
      const older = await new ClubClient(conn).messages({ before: oldest.id, limit: 50 });
      if (older.length === 0) {
        hasMoreRef.current = false;
        return false;
      }
      setMessages((cur) => {
        const existing = new Set(cur.map((m) => m.id));
        const fresh = older.filter((m) => !existing.has(m.id));
        return fresh.length ? [...fresh, ...cur] : cur;
      });
      return true;
    } catch {
      return false;
    } finally {
      setLoadingMore(false);
    }
  }, [conn, loadingMore]);

  return { messages, status, setMessages, loadMore, loadingMore, onlineIds };
}