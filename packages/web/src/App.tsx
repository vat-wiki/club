import { useCallback, useEffect, useRef, useState } from "react";
import type { ImageMime, Message, Participant } from "@club/shared";
import type { ClubConn } from "@club/sdk";
import { loadConn, saveConn, saveRecoverCode, clearConn, API_URL, getKey } from "@/lib/auth";
import { api } from "@/lib/api";
import { useMessageStream } from "@/hooks/use-message-stream";
import { useRooms, type MentionToast } from "@/hooks/use-rooms";
import { useVisualViewportHeight } from "@/hooks/use-visual-viewport-height";
import { useI18n } from "@/lib/i18n";
import { Topbar } from "@/components/topbar";
import { Roster } from "@/components/roster";
import { MessageList, type MessageListHandle } from "@/components/message-list";
import { SearchBar } from "@/components/search-bar";
import { Composer } from "@/components/composer";
import { AuthDialog } from "@/components/auth-dialog";
import { SignOutConfirmDialog } from "@/components/sign-out-confirm-dialog";
import { BootScreen } from "@/components/boot-screen";
import { TypingIndicator } from "@/components/typing-indicator";
import { MentionToasts } from "@/components/mention-toast";
import { AccountCreatedToast } from "@/components/account-created-toast";
import { useTypingAgents } from "@/hooks/use-typing-agents";

export default function App() {
  const { t } = useI18n();
  const messageListRef = useRef<MessageListHandle>(null);
  // Drive #root height from the visual viewport so the composer stays visible
  // above the mobile soft keyboard and the page can't be dragged off-screen.
  // No-op on desktop / browsers without visualViewport. On shrink (keyboard
  // opening), re-pin the message list to the bottom so the latest message
  // isn't hidden behind the keyboard — but only if the user was already
  // pinned there.
  useVisualViewportHeight(() => messageListRef.current?.scrollToBottomIfPinned());
  const [conn, setConn] = useState<ClubConn | null>(() => loadConn());
  const [me, setMe] = useState<Participant | null>(null);
  const [members, setMembers] = useState<Participant[]>([]);
  const [authOpen, setAuthOpen] = useState(!conn);
  const [signOutOpen, setSignOutOpen] = useState(false);
  // Account created toast state (P0-7: non-blocking toast instead of blocking reveal)
  const [accountCreatedToast, setAccountCreatedToast] = useState<{
    recoverCode: string;
  } | null>(null);
  // The message being replied to (puts the composer in "reply" mode with a
  // quote preview); null in normal compose mode.
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  // First-load gate state. "loading" while validating a stored key against /me
  // (and pulling the first history batch); "error" when that validation fails —
  // which used to silently clearConn() and bounce the user to onboarding with no
  // explanation (and, on a transient server hiccup, cost them their credential).
  // Now we keep the key and surface a retryable error screen instead (P0-2).
  // Null once we're past boot (entered the room OR there was no stored key).
  const [bootStatus, setBootStatus] = useState<"loading" | "error" | null>(!!conn ? "loading" : null);
  // Bumped on each manual retry to force the boot effect to re-run (and to reset
  // BootScreen's auto-retry counter). The effect deps include this nonce.
  const [bootRetryNonce, setBootRetryNonce] = useState(0);

  const typing = useTypingAgents(me?.id);
  // Multi-room: room list, the focused room (persisted), per-room unread, and
  // cross-room @mention toasts. The stream below subscribes to ALL rooms and
  // routes each message: focused-room → visible tail, others → unread/toast.
  const rooms = useRooms(conn, me?.name);
  // Mirror the focused room into a ref so validateConn (a boot-time callback
  // whose deps must NOT include the room, or it'd re-trigger boot on every
  // switch) reads the latest value.
  const currentRoomRef = useRef(rooms.currentRoom);
  currentRoomRef.current = rooms.currentRoom;

  const { messages, status, setMessages, loadMore, loadingMore, onlineIds } = useMessageStream(me ? conn : null, {
    currentRoom: rooms.currentRoom,
    onIncoming: rooms.recordIncoming,
    onAgentThinking: typing.onThinking,
    onAgentIdle: typing.onIdle,
  });
  // True while a room's initial history is being fetched (switch = "换台"); the
  // MessageList shows a shimmer skeleton instead of flashing empty-then-pop.
  const [loadingRoom, setLoadingRoom] = useState(false);
  // A message id to deep-link to (from a cross-room mention toast); cleared once
  // the MessageList has scrolled to + highlighted it.
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);

  const refreshMembers = useCallback(async () => {
    if (!conn) return;
    try {
      setMembers(await api.members(conn));
    } catch {
      /* transient */
    }
  }, [conn]);

  // Validate a stored key against /me and load the first history batch. Shared
  // by the initial boot and by every retry (manual + auto-backoff + online
  // event). On success: enter the room. On failure: flip to the error state —
  // but NEVER clearConn(): the key stays in localStorage so a later retry can
  // succeed once the server is reachable again.
  const validateConn = useCallback(
    async (c: ClubConn) => {
      setBootStatus("loading");
      try {
        const m = await api.me(c);
        setMe(m);
        setAuthOpen(false);
        // Load the focused room's history (defaults to general for a fresh
        // client; a returning client resumes its last room from localStorage).
        const history = await api.messages(c, undefined, currentRoomRef.current);
        setMessages(history);
        setBootStatus(null);
        void refreshMembers();
      } catch {
        setBootStatus("error");
      }
    },
    [refreshMembers, setMessages],
  );

  // Load one room's initial history. Shared by the boot path and every room
  // switch: clear the old tail, fetch, swap in. The MessageList is keyed by the
  // room so it remounts and plays the 180ms cross-fade; loadingRoom routes the
  // empty moment to a shimmer skeleton instead of the empty state.
  const loadRoomHistory = useCallback(
    async (c: ClubConn, room: string) => {
      setLoadingRoom(true);
      try {
        setMessages([]);
        const history = await api.messages(c, undefined, room);
        setMessages(history);
      } catch {
        /* transient — the live stream keeps delivering new messages */
      } finally {
        setLoadingRoom(false);
      }
    },
    [setMessages],
  );

  const handleSwitchRoom = useCallback(
    (room: string) => {
      if (!conn || room === rooms.currentRoom) return;
      rooms.switchRoom(room);
      void loadRoomHistory(conn, room);
    },
    [conn, rooms, loadRoomHistory],
  );

  const handleCreateRoom = useCallback(
    async (name: string) => {
      if (!conn) return;
      // createRoom is idempotent and switches focus to the new room; load its
      // (empty) history so the empty state renders cleanly.
      await rooms.createRoom(name);
      void loadRoomHistory(conn, name);
    },
    [conn, rooms, loadRoomHistory],
  );

  // Cross-room mention toast → jump to the source room + scroll/highlight the
  // message. The MessageList retries the highlight as history loads, so setting
  // the target before the fetch resolves is safe.
  const handleToastActivate = useCallback(
    (toast: MentionToast) => {
      handleSwitchRoom(toast.room);
      setHighlightMessageId(toast.messageId);
      rooms.dismissToastsForRoom(toast.room);
    },
    [handleSwitchRoom, rooms],
  );

  // boot: validate stored key (initial + on every retry nonce bump).
  // validateConn runs in the server-response path (401 / 404) and never throws
  // at this level, but we keep .catch so no unhandled-rejection bubble escapes.
  useEffect(() => {
    if (!conn) return;
    let cancelled = false;
    (async () => {
      await validateConn(conn);
      if (cancelled) return;
    })().catch(() => {
      /* keep app mounted; errors are surfaced inside validateConn */
    });
    return () => {
      cancelled = true;
    };
    // bootRetryNonce drives manual/auto re-runs without changing `conn` identity.
     
  }, [conn, bootRetryNonce, validateConn]);

  // Kick a retry: bump the nonce so the boot effect re-runs validateConn, and
  // BootScreen resets its attempt counter.
  const retryBoot = useCallback(() => setBootRetryNonce((n) => n + 1), []);

  // periodic roster refresh (members change rarely)
  useEffect(() => {
    if (!me) return;
    const t = setInterval(refreshMembers, 8000);
    return () => clearInterval(t);
  }, [me, refreshMembers]);

  const handleAuthed = (key: string) => {
    saveConn(key);
    setConn({ server: API_URL, key });
  };

  // A brand-new identity was minted. Save key + recover code immediately (P0-7:
  // non-blocking flow). Show a toast with the recover code so the user can copy it.
  const handleCreated = (key: string, recoverCode: string) => {
    saveConn(key);
    saveRecoverCode(recoverCode);
    setConn({ server: API_URL, key });
    setAuthOpen(false);
    // Show non-blocking toast with recover code
    setAccountCreatedToast({ recoverCode });
  };

  // An identity was *recovered* (callsign + recovery code). The server rotated
  // BOTH the key and the recovery code. Save both immediately and show a toast.
  const handleRecovered = (key: string, recoverCode: string) => {
    saveConn(key);
    saveRecoverCode(recoverCode);
    setConn({ server: API_URL, key });
    setAuthOpen(false);
    // Show non-blocking toast with recover code
    setAccountCreatedToast({ recoverCode });
  };

  const handleSend = async (content: string, attachmentIds: readonly string[], replyToId?: string) => {
    if (!conn || !me) return;
    // Optimistic echo: drop the message into the list immediately as "sending"
    // so the user sees their own text without waiting on the SSE round-trip —
    // this is the fix for the "send feels laggy" feedback. POST /messages
    // resolves with the confirmed Message (real id + accurate attachment
    // metadata), which swaps in for the placeholder; useMessageStream then
    // dedupes SSE's own echo by id. On failure we tint the row red and
    // re-throw so the composer restores the draft for a retry.
    const tempId = `optimist-${crypto.randomUUID()}`;
    const optimistic: Message = {
      id: tempId,
      participantId: me.id,
      authorName: me.name,
      content,
      createdAt: Date.now(),
      room: rooms.currentRoom,
      status: "sending",
      ...(replyToId ? { replyToId } : {}),
      // Only the upload id is known client-side, so synthesize a displayable
      // attachment shape from /files/{id}; the confirmed copy carries the real
      // mime/size. The <img> only needs the url to render.
      attachments: attachmentIds.length
        ? attachmentIds.map((id) => ({
            id,
            url: `/files/${id}`,
            mime: "image/jpeg" as ImageMime,
            size: 0,
          }))
        : undefined,
    };
    setMessages((prev) => [...prev, optimistic]);
    void refreshMembers();
    try {
      const real = await api.send(conn, content, attachmentIds, replyToId, rooms.currentRoom);
      setMessages((prev) => {
        // SSE may have already delivered the confirmed copy — the server
        // broadcasts the new message and can beat the POST response back to
        // the client. If so, just drop the placeholder; otherwise swap it in.
        // Either way avoid leaving the temp id next to the real one, which
        // would render the message twice.
        if (prev.some((m) => m.id === real.id)) {
          return prev.filter((m) => m.id !== tempId);
        }
        return prev.map((m) => (m.id === tempId ? real : m));
      });
    } catch (e) {
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, status: "failed" as const } : m)),
      );
      throw e;
    }
  };

  const handleDelete = async (id: string) => {
    if (!conn) return;
    // Optimistically mark recalled; the server's message_deleted broadcast
    // confirms and syncs everyone else. Revert on failure so the row isn't stuck.
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, deleted: true } : m)));
    try {
      await api.deleteMessage(conn, id);
    } catch {
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, deleted: false } : m)));
    }
  };

  const handleReact = async (messageId: string, emoji: string) => {
    if (!conn) return;
    // Best-effort: the server toggles and broadcasts the refreshed aggregate,
    // which is what updates the UI (no optimistic guess needed).
    try {
      await api.react(conn, messageId, emoji);
    } catch {
      /* ignore — reaction is best-effort */
    }
  };

  const performSignOut = () => {
    clearConn();
    setConn(null);
    setMe(null);
    setMessages([]);
    setMembers([]);
    setSignOutOpen(false);
    setAuthOpen(true);
  };

  // Keep the document title in sync with the active language + focused room.
  useEffect(() => {
    document.title = t("app.title", { room: rooms.currentRoom });
  }, [t, rooms.currentRoom]);

  return (
    <div className="flex h-full flex-col">
      {/* Skip link: first focusable element, lets keyboard/SR users jump to the
          chat. Visually hidden until focused. */}
      <a
        href="#main"
        className="sr-only z-[60] rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-3 focus:top-3"
      >
        {t("app.skipToChat")}
      </a>

      {me && (
        <Topbar
          meName={me.name}
          status={status}
          members={members}
          selfId={me.id}
          onlineIds={onlineIds}
          key_={getKey()}
          currentRoom={rooms.currentRoom}
          rooms={rooms.sortedRooms}
          unread={rooms.unread}
          onSelectRoom={handleSwitchRoom}
          onCreateRoom={handleCreateRoom}
          onSignOutRequest={() => setSignOutOpen(true)}
        />
      )}

      <div className="flex min-h-0 flex-1">
        <Roster
          members={members}
          selfId={me?.id}
          onlineIds={onlineIds}
          rooms={rooms.sortedRooms}
          currentRoom={rooms.currentRoom}
          unread={rooms.unread}
          onSelectRoom={handleSwitchRoom}
          onCreateRoom={handleCreateRoom}
        />
        <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
          {/* Visually-hidden h1 gives the view a heading for SR users without
              duplicating the visible topbar wordmark. */}
          <h1 className="sr-only">{t("app.h1", { room: rooms.currentRoom })}</h1>
          {/* First-load gate. While bootStatus is set we render the boot screen
              (loading spinner OR retryable error) instead of the message list +
              composer, so a server-down on reload never silently wipes the key
              or strands the user in the empty state. Once null, the room shows. */}
          {bootStatus ? (
            <BootScreen status={bootStatus} retryNonce={bootRetryNonce} onRetry={retryBoot} />
          ) : (
            <>
              <SearchBar conn={conn} room={rooms.currentRoom} />
              {/* key={room} forces a remount on switch → 180ms cross-fade. */}
              <MessageList
                key={rooms.currentRoom}
                ref={messageListRef}
                messages={messages}
                me={me}
                members={members}
                status={status}
                room={rooms.currentRoom}
                loadingRoom={loadingRoom}
                highlightMessageId={highlightMessageId}
                onHighlightConsumed={() => setHighlightMessageId(null)}
                onLoadMore={loadMore}
                loadingMore={loadingMore}
                onReply={setReplyTo}
                onDelete={handleDelete}
                onReact={handleReact}
              />
              {typing.agents.length > 0 && (
                <TypingIndicator agents={typing.agents} />
              )}
              <Composer
                onSend={handleSend}
                disabled={!me}
                members={members}
                selfId={me?.id}
                conn={conn}
                room={rooms.currentRoom}
                replyTo={replyTo}
                onReplyClear={() => setReplyTo(null)}
              />
            </>
          )}
        </main>
      </div>

      {/* Cross-room @mention toasts (P1). Live regardless of which panel is open;
          clicking jumps to the source room + message. */}
      <MentionToasts
        toasts={rooms.toasts}
        onActivate={handleToastActivate}
        onDismiss={rooms.dismissToast}
      />

      {/* Account created toast (P0-7: non-blocking, shows recover code after registration) */}
      {accountCreatedToast && (
        <AccountCreatedToast
          recoverCode={accountCreatedToast.recoverCode}
          onDismiss={() => setAccountCreatedToast(null)}
        />
      )}

      {/*
        AuthDialog is keyed by authOpen so it fully remounts whenever it (re)opens.
        This clears all internal form state (mode, name, pasteKey, error) on every
        sign-out → re-join cycle, fixing the "name is taken" collision caused by
        a stale nickname lingering in component state after sign-out.
      */}
      <AuthDialog
        key={authOpen ? "auth-open" : "auth-closed"}
        open={authOpen}
        onCreated={handleCreated}
        onAuthed={handleAuthed}
        onRecovered={handleRecovered}
      />

      {/* Confirm before wiping the key from this machine. */}
      <SignOutConfirmDialog
        open={signOutOpen}
        onOpenChange={setSignOutOpen}
        key_={getKey()}
        onConfirm={performSignOut}
      />
    </div>
  );
}
