import { api } from '@/lib/api';
import { mentionsSelf } from '@/lib/format';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ClubConn } from '@club/sdk';
import type { Channel,Message } from '@club/shared';

/**
 * useChannels — multi-channel state for the web client.
 *
 * Owns the channel list (`GET /channels`), the focused channel (persisted to
 * `localStorage`), per-channel unread counts (client-side, NOT persisted across
 * sessions — PRD §5.2), and transient cross-channel @mention toasts (PRD §5.5).
 *
 * The live SSE stream delivers events from ALL channels (see use-message-stream).
 * This hook's `recordIncoming` routes them: a message in the focused channel is
 * already on screen so it only refreshes that channel's activity sort; a message
 * in another channel bumps its unread pill, and a @mention there also fires a toast.
 *
 * Sort order: unread-first, then most-recently-active-first. The server's
 * `lastActivityAt` is supplemented with live overrides from incoming SSE
 * messages so the sort reflects real-time activity, not just the last poll.
 *
 * @param conn    - Active connection; `null` resets the channel list and clears
 *                  session-only state (unread, toasts). On re-login under a
 *                  different identity the state is cleared so there's no leak.
 * @param selfName - Current participant name; used to detect `@selfName`
 *                   mentions in cross-channel messages and fire toasts.
 * @returns `{ channels, sortedChannels, currentChannel, unread, toasts, loading,
 *             switchChannel, createChannel, refreshChannels, recordIncoming,
 *             dismissToast, dismissToastsForChannel }`.
 * @example
 * const { channels, currentChannel, switchChannel, createChannel, unread, recordIncoming } =
 *   useChannels(conn, me?.name);
 */

const CHANNEL_STORAGE_KEY = 'club_channel';

function loadInitialChannel(): string {
  try {
    const v = localStorage.getItem(CHANNEL_STORAGE_KEY);
    // Defensive: a stale/invalid value must never pin the app to a bad channel.
    if (v && /^[a-z0-9][a-z0-9-]{0,29}$/.test(v)) return v;
  } catch {
    /* localStorage may be unavailable (private mode) */
  }
  return 'general';
}

export interface ChannelUnread {
  count: number;
  mention: boolean;
}

export interface MentionToast {
  /** Unique toast id (so React keys + dismiss are stable). */
  id: string;
  messageId: string;
  channel: string;
  authorName: string;
  content: string;
}

export interface UseChannelsResult {
  channels: Channel[];
  /** Channels sorted "unread-first, then most-recently-active-first" (user decision
   *  overriding the design default of general-pinned + alphabetical). `general`
   *  keeps its system-channel visual mark but flows by this rule. */
  sortedChannels: Channel[];
  currentChannel: string;
  unread: Record<string, ChannelUnread>;
  toasts: MentionToast[];
  /** Loading the channel list (first fetch). */
  loading: boolean;
  /** Switch the focused channel: persist, clear that channel's unread, drop its toasts. */
  switchChannel: (channel: string) => void;
  /** Create a channel (idempotent) and switch to it ("build = enter"). */
  createChannel: (name: string) => Promise<Channel>;
  /** Re-fetch the channel list. */
  refreshChannels: () => Promise<void>;
  /** Route an incoming SSE message: bump unread / fire a toast for other channels. */
  recordIncoming: (m: Message) => void;
  dismissToast: (id: string) => void;
  /** Drop every toast whose source is `channel` (used when navigating to it). */
  dismissToastsForChannel: (channel: string) => void;
}

export function useChannels(conn: ClubConn | null, selfName?: string): UseChannelsResult {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [currentChannel, setCurrentChannel] = useState<string>(loadInitialChannel);
  const [unread, setUnread] = useState<Record<string, ChannelUnread>>({});
  const [toasts, setToasts] = useState<MentionToast[]>([]);
  const [loading, setLoading] = useState(false);

  // Live lastActivityAt overrides: the server's value is only as fresh as the
  // last GET /channels poll, so an incoming message supersedes it for sorting. Keyed
  // by channel slug. Kept in a ref + state mirror isn't needed — sorting reads this
  // via the memo, which re-runs when `channels` or `unread` change (those change on
  // incoming messages too, so the memo stays fresh).
  const activityOverrideRef = useRef<Record<string, number>>({});

  // Keep the freshest current channel + self name in refs so recordIncoming (called
  // on every SSE message) reads the latest without needing to be in stream deps.
  const currentChannelRef = useRef(currentChannel);
  currentChannelRef.current = currentChannel;
  const selfNameRef = useRef(selfName);
  selfNameRef.current = selfName;

  const refreshChannels = useCallback(async () => {
    if (!conn) return;
    setLoading(true);
    try {
      const list = await api.channels(conn);
      setChannels(list);
      // If the focused channel vanished (can't happen this phase — channels aren't
      // deletable — but guard anyway), fall back to general so the UI never
      // points at a channel the server doesn't know.
      setCurrentChannel((cur) => (list.some((r) => r.slug === cur) ? cur : 'general'));
    } catch {
      /* transient — keep showing the stale list */
    } finally {
      setLoading(false);
    }
  }, [conn]);

  // Initial + connection-scoped channel list fetch. Re-runs when the identity
  // changes (sign-in / sign-out), not on every channel switch. On disconnect the
  // unread/toast state is cleared so a re-login under a different identity
  // starts clean (unread is client-side + session-only by design — PRD §5.2).
  useEffect(() => {
    if (!conn) {
      setChannels([]);
      setUnread({});
      setToasts([]);
      return;
    }
    void refreshChannels();
  }, [conn?.server, conn?.key, refreshChannels]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchChannel = useCallback((channel: string) => {
    setCurrentChannel(channel);
    try {
      localStorage.setItem(CHANNEL_STORAGE_KEY, channel);
    } catch {
      /* localStorage may be unavailable */
    }
    // Entering a channel clears its unread (PRD §5.2) and dismisses its toasts.
    setUnread((prev) => (prev[channel] ? { ...prev, [channel]: { count: 0, mention: false } } : prev));
    setToasts((prev) => prev.filter((t) => t.channel !== channel));
  }, []);

  const createChannel = useCallback(
    async (name: string): Promise<Channel> => {
      if (!conn) throw new Error('not connected');
      const channel = await api.createChannel(conn, name);
      // Merge into the list (idempotent: a duplicate slug returns the existing
      // channel, so dedupe by slug to avoid a phantom duplicate row).
      setChannels((prev) => (prev.some((r) => r.slug === channel.slug) ? prev : [...prev, channel]));
      switchChannel(channel.slug);
      return channel;
    },
    [conn, switchChannel]
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissToastsForChannel = useCallback((channel: string) => {
    setToasts((prev) => prev.filter((t) => t.channel !== channel));
  }, []);

  const recordIncoming = useCallback((m: Message) => {
    // Refresh the activity sort for whichever channel this landed in.
    activityOverrideRef.current = {
      ...activityOverrideRef.current,
      [m.channel]: Math.max(activityOverrideRef.current[m.channel] ?? 0, m.createdAt),
    };
    if (m.channel === currentChannelRef.current) return; // already on screen
    const isMention = mentionsSelf(m.content, selfNameRef.current);
    setUnread((prev) => {
      const cur = prev[m.channel] ?? { count: 0, mention: false };
      return { ...prev, [m.channel]: { count: cur.count + 1, mention: cur.mention || isMention } };
    });
    // A cross-channel @mention fires a toast with a deep-link to the source.
    if (isMention) {
      const toast: MentionToast = {
        id: `${m.id}-${m.channel}`,
        messageId: m.id,
        channel: m.channel,
        authorName: m.authorName,
        content: m.content,
      };
      setToasts((prev) => {
        // Avoid stacking duplicate toasts for the same message (the SSE may
        // redeliver on reconnect catch-up). Keep at most a handful visible.
        if (prev.some((t) => t.messageId === m.id)) return prev;
        const next = [...prev, toast];
        return next.length > 4 ? next.slice(next.length - 4) : next;
      });
    }
  }, []);

  // Client-side sort: unread channels first (most-recently-active first), then read
  // channels (most-recently-active first). null lastActivityAt sorts as oldest.
  const sortedChannels = useMemo(() => {
    const activity = (r: Channel) => {
      const override = activityOverrideRef.current[r.slug] ?? 0;
      return Math.max(r.lastActivityAt ?? 0, override);
    };
    const hasUnread = (r: Channel) => (unread[r.slug]?.count ?? 0) > 0;
    return [...channels].sort((a, b) => {
      const ua = hasUnread(a) ? 1 : 0;
      const ub = hasUnread(b) ? 1 : 0;
      if (ua !== ub) return ub - ua; // unread first
      return activity(b) - activity(a); // then most-recently-active first
    });
    // `channels` changes identity on refresh; `unread` changes on incoming messages
    // (which is also when activityOverride moves). activityOverrideRef is a ref so
    // it isn't a dep, but unread changes cover the same moments.
  }, [channels, unread]);

  return {
    channels,
    sortedChannels,
    currentChannel,
    unread,
    toasts,
    loading,
    switchChannel,
    createChannel,
    refreshChannels,
    recordIncoming,
    dismissToast,
    dismissToastsForChannel,
  };
}
