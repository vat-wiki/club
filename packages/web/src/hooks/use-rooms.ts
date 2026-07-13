import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClubConn } from "@club/sdk";
import type { Message, Room } from "@club/shared";
import { mentionsSelf } from "@/lib/format";
import { api } from "@/lib/api";

// ── Multi-room state for the web client ──────────────────────────────
//
// Owns: the room list (GET /rooms), the current/focused room (persisted to
// localStorage), per-room unread counts (client-side, PRD §5.2 — NOT persisted
// across sessions; a persisted read-waterline is a future enhancement), and the
// transient cross-room @mention toasts (PRD §5.5).
//
// The live SSE stream delivers events from ALL rooms (see use-message-stream);
// this hook's `recordIncoming` routes them: a message in the focused room is
// already on screen, so it only refreshes that room's activity sort; a message
// in another room bumps its unread pill, and a @mention there also fires a toast.

const ROOM_STORAGE_KEY = "club_room";

function loadInitialRoom(): string {
  try {
    const v = localStorage.getItem(ROOM_STORAGE_KEY);
    // Defensive: a stale/invalid value must never pin the app to a bad room.
    if (v && /^[a-z0-9][a-z0-9-]{0,29}$/.test(v)) return v;
  } catch {
    /* localStorage may be unavailable (private mode) */
  }
  return "general";
}

export interface RoomUnread {
  count: number;
  mention: boolean;
}

export interface MentionToast {
  /** Unique toast id (so React keys + dismiss are stable). */
  id: string;
  messageId: string;
  room: string;
  authorName: string;
  content: string;
}

export interface UseRoomsResult {
  rooms: Room[];
  /** Rooms sorted "unread-first, then most-recently-active-first" (user decision
   *  overriding the design default of general-pinned + alphabetical). `general`
   *  keeps its system-room visual mark but flows by this rule. */
  sortedRooms: Room[];
  currentRoom: string;
  unread: Record<string, RoomUnread>;
  toasts: MentionToast[];
  /** Loading the room list (first fetch). */
  loading: boolean;
  /** Switch the focused room: persist, clear that room's unread, drop its toasts. */
  switchRoom: (room: string) => void;
  /** Create a room (idempotent) and switch to it ("build = enter"). */
  createRoom: (name: string) => Promise<Room>;
  /** Re-fetch the room list. */
  refreshRooms: () => Promise<void>;
  /** Route an incoming SSE message: bump unread / fire a toast for other rooms. */
  recordIncoming: (m: Message) => void;
  dismissToast: (id: string) => void;
  /** Drop every toast whose source is `room` (used when navigating to it). */
  dismissToastsForRoom: (room: string) => void;
}

export function useRooms(conn: ClubConn | null, selfName?: string): UseRoomsResult {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [currentRoom, setCurrentRoom] = useState<string>(loadInitialRoom);
  const [unread, setUnread] = useState<Record<string, RoomUnread>>({});
  const [toasts, setToasts] = useState<MentionToast[]>([]);
  const [loading, setLoading] = useState(false);

  // Live lastActivityAt overrides: the server's value is only as fresh as the
  // last GET /rooms poll, so an incoming message supersedes it for sorting. Keyed
  // by room slug. Kept in a ref + state mirror isn't needed — sorting reads this
  // via the memo, which re-runs when `rooms` or `unread` change (those change on
  // incoming messages too, so the memo stays fresh).
  const activityOverrideRef = useRef<Record<string, number>>({});

  // Keep the freshest current room + self name in refs so recordIncoming (called
  // on every SSE message) reads the latest without needing to be in stream deps.
  const currentRoomRef = useRef(currentRoom);
  currentRoomRef.current = currentRoom;
  const selfNameRef = useRef(selfName);
  selfNameRef.current = selfName;

  const refreshRooms = useCallback(async () => {
    if (!conn) return;
    setLoading(true);
    try {
      const list = await api.rooms(conn);
      setRooms(list);
      // If the focused room vanished (can't happen this phase — rooms aren't
      // deletable — but guard anyway), fall back to general so the UI never
      // points at a room the server doesn't know.
      setCurrentRoom((cur) => (list.some((r) => r.slug === cur) ? cur : "general"));
    } catch {
      /* transient — keep showing the stale list */
    } finally {
      setLoading(false);
    }
  }, [conn]);

  // Initial + connection-scoped room list fetch. Re-runs when the identity
  // changes (sign-in / sign-out), not on every room switch. On disconnect the
  // unread/toast state is cleared so a re-login under a different identity
  // starts clean (unread is client-side + session-only by design — PRD §5.2).
  useEffect(() => {
    if (!conn) {
      setRooms([]);
      setUnread({});
      setToasts([]);
      return;
    }
    void refreshRooms();
  }, [conn?.server, conn?.key, refreshRooms]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchRoom = useCallback((room: string) => {
    setCurrentRoom(room);
    try {
      localStorage.setItem(ROOM_STORAGE_KEY, room);
    } catch {
      /* localStorage may be unavailable */
    }
    // Entering a room clears its unread (PRD §5.2) and dismisses its toasts.
    setUnread((prev) => (prev[room] ? { ...prev, [room]: { count: 0, mention: false } } : prev));
    setToasts((prev) => prev.filter((t) => t.room !== room));
  }, []);

  const createRoom = useCallback(
    async (name: string): Promise<Room> => {
      if (!conn) throw new Error("not connected");
      const room = await api.createRoom(conn, name);
      // Merge into the list (idempotent: a duplicate slug returns the existing
      // room, so dedupe by slug to avoid a phantom duplicate row).
      setRooms((prev) => (prev.some((r) => r.slug === room.slug) ? prev : [...prev, room]));
      switchRoom(room.slug);
      return room;
    },
    [conn, switchRoom],
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissToastsForRoom = useCallback((room: string) => {
    setToasts((prev) => prev.filter((t) => t.room !== room));
  }, []);

  const recordIncoming = useCallback(
    (m: Message) => {
      // Refresh the activity sort for whichever room this landed in.
      activityOverrideRef.current = {
        ...activityOverrideRef.current,
        [m.room]: Math.max(activityOverrideRef.current[m.room] ?? 0, m.createdAt),
      };
      if (m.room === currentRoomRef.current) return; // already on screen
      const isMention = mentionsSelf(m.content, selfNameRef.current);
      setUnread((prev) => {
        const cur = prev[m.room] ?? { count: 0, mention: false };
        return { ...prev, [m.room]: { count: cur.count + 1, mention: cur.mention || isMention } };
      });
      // A cross-room @mention fires a toast with a deep-link to the source.
      if (isMention) {
        const toast: MentionToast = {
          id: `${m.id}-${m.room}`,
          messageId: m.id,
          room: m.room,
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
    },
    [],
  );

  // Client-side sort: unread rooms first (most-recently-active first), then read
  // rooms (most-recently-active first). null lastActivityAt sorts as oldest.
  const sortedRooms = useMemo(() => {
    const activity = (r: Room) => {
      const override = activityOverrideRef.current[r.slug] ?? 0;
      return Math.max(r.lastActivityAt ?? 0, override);
    };
    const hasUnread = (r: Room) => (unread[r.slug]?.count ?? 0) > 0;
    return [...rooms].sort((a, b) => {
      const ua = hasUnread(a) ? 1 : 0;
      const ub = hasUnread(b) ? 1 : 0;
      if (ua !== ub) return ub - ua; // unread first
      return activity(b) - activity(a); // then most-recently-active first
    });
    // `rooms` changes identity on refresh; `unread` changes on incoming messages
    // (which is also when activityOverride moves). activityOverrideRef is a ref so
    // it isn't a dep, but unread changes cover the same moments.
  }, [rooms, unread]);

  return {
    rooms,
    sortedRooms,
    currentRoom,
    unread,
    toasts,
    loading,
    switchRoom,
    createRoom,
    refreshRooms,
    recordIncoming,
    dismissToast,
    dismissToastsForRoom,
  };
}
