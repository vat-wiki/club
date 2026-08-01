import { useCallback, useEffect, useRef, useState } from 'react';

import { ClubClient, type ClubConn } from '@club/sdk';
import type { AgentIdleEvent, AgentThinkingEvent, Message, MessageEditedEvent } from '@club/shared';

type Status = 'connecting' | 'connected' | 'lost';

export interface UseMessageStreamOptions {
  /** Fired for `agent_thinking` SSE events — drives the typing indicator
   * (PRD §5). Only events for the focused channel are forwarded to this callback;
   * other channels are filtered inside the hook so the indicator never shows
   * a participant thinking in a channel the user isn't viewing. */
  onAgentThinking?: (e: AgentThinkingEvent) => void;
  /** Fired for `agent_idle` SSE events — clears a participant from the typing
   * indicator. Channel-scoped like `onAgentThinking`. */
  onAgentIdle?: (e: AgentIdleEvent) => void;
  /** The channel currently in focus. Only its messages are appended to the visible
   *  `messages` tail; other channels' messages are routed to `onIncoming` for
   *  unread tracking. The stream itself subscribes to ALL channels (no channel filter)
   *  so cross-channel unread + @mention toasts stay live. Read via a ref so the
   *  handler is stable across channel switches without re-subscribing. */
  currentChannel?: string;
  /** Fired for EVERY incoming message regardless of channel — drives per-channel
   *  unread counts and cross-channel mention toasts (see use-channels). */
  onIncoming?: (m: Message) => void;
  /** Fired for `message_edited` SSE events in the focused channel - the caller
   *  swaps the matching message by id (content/attachments/editedAt). Channel-
   *  scoped like the other message events; other channels are filtered here. */
  onMessageEdited?: (e: MessageEditedEvent) => void;
}

/**
 * useMessageStream — the live SSE subscription for the focused channel's message
 * tail, plus all-channels event fan-out (unread, @mentions, presence, reactions,
 * deletions, typing events).
 *
 * The stream connects to ALL channels (no channel filter) because the web client must
 * track per-channel unread counts and cross-channel @mention toasts (PRD §5). Messages
 * are filtered client-side to `currentChannel` for the visible list; everything
 * else flows through `opts.onIncoming` / the dedicated event callbacks.
 *
 * Reconnection: when the stream closes on its own (network drop, server restart),
 * the hook auto-reconnects with a 3s backoff. Switching channels does NOT tear down
 * the stream — `currentChannel` is read from a ref so display routing changes without
 * a re-subscribe, which keeps presence/online roster stable across channel switches.
 *
 * The returned `onlineIds` set is the roster's live presence: it is re-seeded from
 * the server on (re)connect and cleared on channel switches to avoid stale entries.
 *
 * @param conn    - Active connection; `null` disconnects (mount/unmount safe).
 * @param opts    - Callbacks and focus config. See `UseMessageStreamOptions`.
 * @returns `{ messages, status, setMessages, loadMore, loadingMore, onlineIds }`.
 * @example
 * const { messages, status, loadMore, onlineIds } = useMessageStream(conn, {
 *   currentChannel,
 *   onIncoming,
 *   onAgentThinking: onThinking,
 *   onAgentIdle: onIdle,
 * });
 */
export function useMessageStream(conn: ClubConn | null, opts: UseMessageStreamOptions = {}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<Status>('connecting');
  const [loadingMore, setLoadingMore] = useState(false);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());

  // Latest channel + callbacks via refs so the SSE effect deps stay on `conn`
  // (we drive our own reconnect) while still reading the freshest values.
  const currentChannelRef = useRef(opts.currentChannel ?? 'general');
  currentChannelRef.current = opts.currentChannel ?? 'general';
  const incomingRef = useRef(opts.onIncoming);
  incomingRef.current = opts.onIncoming;
  const thinkingRef = useRef(opts.onAgentThinking);
  thinkingRef.current = opts.onAgentThinking;
  const idleRef = useRef(opts.onAgentIdle);
  idleRef.current = opts.onAgentIdle;
  const editedRef = useRef(opts.onMessageEdited);
  editedRef.current = opts.onMessageEdited;

  useEffect(() => {
    if (!conn) return;
    let stopped = false;
    let sub: { stop: () => void } | null = null;
    let reconnect: ReturnType<typeof setTimeout>;
    // Reconnect attempt count since the last successful connection — drives the
    // exponential backoff below. Reset to 0 each time a connection is opened.
    let reconnectTries = 0;

    const connect = () => {
      if (stopped) return;
      setStatus('connecting');
      sub = new ClubClient(conn).stream(
        (m) => {
          // Every message refreshes unread/activity tracking (all channels).
          incomingRef.current?.(m);
          // Only the focused channel is appended to the visible tail; other channels
          // are accounted for via onIncoming and stay off the screen.
          if (m.channel !== currentChannelRef.current) return;
          setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
        },
        {
          // Subscribe to ALL channels (no channel/channels filter): the web client tracks
          // per-channel unread + cross-channel @mentions, so it needs every channel's
          // events. The server still does the fan-out; the focused-channel display
          // is filtered client-side above. Channel-scoped subscription is the
          // capability the SDK exposes (used by CLI/MCP); the web client opts
          // into all-channels because it tracks unread (PRD §5.2).
          reconnect: false,
          onError: (err) => {
            if (stopped) return;
            setStatus('lost');
            // Honor the server's Retry-After on 429 when the SDK surfaces it;
            // otherwise back off exponentially (capped at 15s) instead of a
            // fixed 3s. A fixed cadence re-hits a fixed rate-limit window and
            // keeps it pinned at zero — the feedback loop where one stuck
            // client rate-limits itself (and, behind a shared-IP proxy,
            // everyone).
            const retryAfterMs = (err as { retryAfterMs?: number | null })?.retryAfterMs;
            const delay = retryAfterMs ?? Math.min(15_000, 1000 * 2 ** reconnectTries);
            reconnectTries += 1;
            reconnect = setTimeout(connect, delay);
          },
          onAgentThinking: (e) => {
            // Typing indicators are channel-scoped events; only show the ones for
            // the focused channel (others would noise the indicator).
            if (e.channel && e.channel !== currentChannelRef.current) return;
            thinkingRef.current?.(e);
          },
          onAgentIdle: (e) => {
            if (e.channel && e.channel !== currentChannelRef.current) return;
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
            // Only the focused channel's messages are in the visible list.
            if (e.channel !== currentChannelRef.current) return;
            setMessages((prev) => prev.map((m) => (m.id === e.id ? { ...m, deleted: true } : m)));
          },
          onReaction: (e) => {
            if (e.channel !== currentChannelRef.current) return;
            setMessages((prev) =>
              prev.map((m) => (m.id === e.messageId ? { ...m, reactions: e.reactions } : m))
            );
          },
          onMessageEdited: (e) => {
            // Only the focused channel's messages are in the visible list; the
            // caller swaps the matching message by id (content/attachments/editedAt).
            if (e.channel !== currentChannelRef.current) return;
            editedRef.current?.(e);
          },
        }
      );
      setStatus('connected');
      reconnectTries = 0;
    };

    hasMoreRef.current = true;
    // Clear presence on (re)connect so stale "online" entries from a dropped
    // connection don't linger — the server re-seeds the current online set as
    // presence events on connect. This runs only on conn change / reconnect, NOT
    // on channel switch (the stream stays connected across channel focus changes), so
    // the roster never flashes when switching channels.
    setOnlineIds(new Set());
    connect();
    return () => {
      stopped = true;
      clearTimeout(reconnect);
      sub?.stop();
    };
  }, [conn?.server, conn?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  // NOTE: `currentChannel` is intentionally NOT a dep — switching channels must NOT
  // tear down the all-channels stream (that would flash the roster's presence and
  // interrupt unread tracking). Channel focus only re-routes display, via the ref.

  // Live ref of the current tail so loadMore can read the oldest id without
  // becoming a dep of the callback (which would re-create it on every message).
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  // Assume older history exists until a `before` fetch returns empty — keeps
  // the UI from hammering the server once we've scrolled to the top of the channel.
  const hasMoreRef = useRef(true);

  /** Load one page of older history for the focused channel (scroll-up pagination).
   *  Prepend de-duped messages before the current tail. Does nothing if there
   *  are no messages yet, the oldest is an optimistic echo, or history is
   *  already exhausted (`hasMoreRef` exhausted on empty server response). */
  const loadMore = useCallback(async (): Promise<boolean> => {
    if (!conn || loadingMore) return false;
    const prev = messagesRef.current;
    if (prev.length === 0) return false;
    const oldest = prev[0];
    // A pending optimistic echo has no server history before it; skip until it
    // resolves into a real id.
    if (oldest.id.startsWith('optimist-')) return false;
    if (!hasMoreRef.current) return false;
    setLoadingMore(true);
    try {
      const older = await new ClubClient(conn).messages({
        before: oldest.id,
        limit: 50,
        channel: currentChannelRef.current,
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
