import { useCallback, useEffect, useRef, useState } from "react";
import { ClubClient, type ClubConn } from "@club/sdk";
import type { AgentThinkingEvent, AgentIdleEvent, Message } from "@club/shared";

type Status = "connecting" | "connected" | "lost";

export interface UseMessageStreamOptions {
  // Forwarded to ClubClient.stream so the typing indicator (P1-5) lights up
  // from the same SSE subscription as the message feed. Stable via refs below.
  onAgentThinking?: (e: AgentThinkingEvent) => void;
  onAgentIdle?: (e: AgentIdleEvent) => void;
  /** The room currently in focus. Only its messages are appended to the visible
   *  `messages` tail; other rooms' messages are routed to `onIncoming` for
   *  unread tracking. The stream itself subscribes to ALL rooms (no room filter)
   *  so cross-room unread + @mention toasts stay live. Read via a ref so the
   *  handler is stable across room switches without re-subscribing. */
  currentRoom?: string;
  /** Fired for EVERY incoming message regardless of room — drives per-room
   *  unread counts and cross-room mention toasts (see use-rooms). */
  onIncoming?: (m: Message) => void;
}

// Live SSE subscription over the shared client. Reconnects with backoff when
// the stream ends on its own; tears down on unmount/key change. Returns the
// growing message tail (deduped by id) for the FOCUSED room plus a connection
// status for the bar. The stream subscribes to all rooms so the client can track
// unread across rooms; messages are filtered to the focused room for display.
export function useMessageStream(
  conn: ClubConn | null,
  opts: UseMessageStreamOptions = {},
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<Status>("connecting");
  const [loadingMore, setLoadingMore] = useState(false);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());

  // Latest room + callbacks via refs so the SSE effect deps stay on `conn`
  // (we drive our own reconnect) while still reading the freshest values.
  const currentRoomRef = useRef(opts.currentRoom ?? "general");
  currentRoomRef.current = opts.currentRoom ?? "general";
  const incomingRef = useRef(opts.onIncoming);
  incomingRef.current = opts.onIncoming;
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
        (m) => {
          // Every message refreshes unread/activity tracking (all rooms).
          incomingRef.current?.(m);
          // Only the focused room is appended to the visible tail; other rooms
          // are accounted for via onIncoming and stay off the screen.
          if (m.room !== currentRoomRef.current) return;
          setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
        },
        {
          // Subscribe to ALL rooms (no room/rooms filter): the web client tracks
          // per-room unread + cross-room @mentions, so it needs every room's
          // events. The server still does the fan-out; the focused-room display
          // is filtered client-side above. Room-scoped subscription is the
          // capability the SDK exposes (used by CLI/MCP); the web client opts
          // into all-rooms because it tracks unread (PRD §5.2).
          reconnect: false,
          onError: () => {
            if (stopped) return;
            setStatus("lost");
            reconnect = setTimeout(connect, 3000);
          },
          onAgentThinking: (e) => {
            // Typing indicators are room-scoped events; only show the ones for
            // the focused room (others would noise the indicator).
            if (e.room && e.room !== currentRoomRef.current) return;
            thinkingRef.current?.(e);
          },
          onAgentIdle: (e) => {
            if (e.room && e.room !== currentRoomRef.current) return;
            idleRef.current?.(e);
          },
          onPresence: (e) => {
            setOnlineIds((prev) => {
              const next = new Set(prev);
              if (e.online) next.add(e.participantId);
              else next.delete(e.participantId);
              return next;
            });
          },
          onMessageDeleted: (e) => {
            // Only the focused room's messages are in the visible list.
            if (e.room !== currentRoomRef.current) return;
            setMessages((prev) => prev.map((m) => (m.id === e.id ? { ...m, deleted: true } : m)));
          },
          onReaction: (e) => {
            if (e.room !== currentRoomRef.current) return;
            setMessages((prev) =>
              prev.map((m) => (m.id === e.messageId ? { ...m, reactions: e.reactions } : m)),
            );
          },
        },
      );
      setStatus("connected");
    };

    hasMoreRef.current = true;
    // Clear presence on (re)connect so stale "online" entries from a dropped
    // connection don't linger — the server re-seeds the current online set as
    // presence events on connect. This runs only on conn change / reconnect, NOT
    // on room switch (the stream stays connected across room focus changes), so
    // the roster never flashes when switching rooms.
    setOnlineIds(new Set());
    connect();
    return () => {
      stopped = true;
      clearTimeout(reconnect);
      sub?.stop();
    };
  }, [conn?.server, conn?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  // NOTE: `currentRoom` is intentionally NOT a dep — switching rooms must NOT
  // tear down the all-rooms stream (that would flash the roster's presence and
  // interrupt unread tracking). Room focus only re-routes display, via the ref.

  // Live ref of the current tail so loadMore can read the oldest id without
  // becoming a dep of the callback (which would re-create it on every message).
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  // Assume older history exists until a `before` fetch returns empty — keeps
  // the UI from hammering the server once we've scrolled to the top of the room.
  const hasMoreRef = useRef(true);

  // Load one page of older history (scroll-up pagination) for the focused room.
  // Prepends anything new, de-duped by id. Returns whether it loaded anything.
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
      const older = await new ClubClient(conn).messages({
        before: oldest.id,
        limit: 50,
        room: currentRoomRef.current,
      });
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
