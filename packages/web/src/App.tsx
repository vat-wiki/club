import { useCallback, useEffect, useRef, useState } from "react";
import type { ImageMime, Message, Participant } from "@club/shared";
import type { ClubConn } from "@club/sdk";
import { loadConn, saveConn, clearConn, API_URL, getKey } from "@/lib/auth";
import { api } from "@/lib/api";
import { useMessageStream } from "@/hooks/use-message-stream";
import { useVisualViewportHeight } from "@/hooks/use-visual-viewport-height";
import { useI18n } from "@/lib/i18n";
import { Topbar } from "@/components/topbar";
import { Roster } from "@/components/roster";
import { MessageList, type MessageListHandle } from "@/components/message-list";
import { SearchBar } from "@/components/search-bar";
import { Composer } from "@/components/composer";
import { AuthDialog } from "@/components/auth-dialog";
import { KeyRevealDialog } from "@/components/key-reveal-dialog";
import { SignOutConfirmDialog } from "@/components/sign-out-confirm-dialog";
import { BootScreen } from "@/components/boot-screen";
import { TypingIndicator } from "@/components/typing-indicator";
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
  // A freshly minted key that the app has NOT yet persisted. While set, we
  // show the KeyRevealDialog instead of entering the room — the user must
  // acknowledge they've saved the key before it lands in localStorage.
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  // The one-time recovery code minted alongside the pending key, surfaced on
  // the reveal dialog so the user records both before entering (PRD §7.1 AC1).
  const [pendingRecoverCode, setPendingRecoverCode] = useState<string>("");
  // True when the pending key came from the *recovery* flow rather than a fresh
  // mint. The reveal dialog then uses rotated-credential copy ("these are NEW,
  // the old ones are dead") so the user understands the recovery code they just
  // used is single-use-spent and the prior key no longer works.
  const [pendingKeyRecovered, setPendingKeyRecovered] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
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

  const typing = useTypingAgents();
  const { messages, status, setMessages, loadMore, loadingMore, onlineIds } = useMessageStream(me ? conn : null, {
    onAgentThinking: typing.onThinking,
    onAgentIdle: typing.onIdle,
  });

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
        const history = await api.messages(c);
        setMessages(history);
        setBootStatus(null);
        void refreshMembers();
      } catch {
        setBootStatus("error");
      }
    },
    [refreshMembers, setMessages],
  );

  // boot: validate stored key (initial + on every retry nonce bump)
  useEffect(() => {
    if (!conn) return;
    let cancelled = false;
    (async () => {
      await validateConn(conn);
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
    // bootRetryNonce drives manual/auto re-runs without changing `conn` identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // A brand-new identity was minted. Don't persist yet — hand the key +
  // recovery code to the reveal dialog so the user can see/copy them first.
  // saveConn + enter only happens when they acknowledge.
  const handleCreated = (key: string, recoverCode: string) => {
    setAuthOpen(false);
    setPendingKey(key);
    setPendingRecoverCode(recoverCode);
    setPendingKeyRecovered(false);
  };

  // An identity was *recovered* (callsign + recovery code). The server rotated
  // BOTH the key and the recovery code; route through the reveal dialog in
  // "recovered" mode so the user records the new pair before we persist —
  // otherwise they'd enter the room with no way to see the new recovery code,
  // and the code they just used is now single-use-dead (P0-1 data-loss fix).
  const handleRecovered = (key: string, recoverCode: string) => {
    setAuthOpen(false);
    setPendingKey(key);
    setPendingRecoverCode(recoverCode);
    setPendingKeyRecovered(true);
  };

  const handleKeySaved = () => {
    if (!pendingKey) return;
    handleAuthed(pendingKey);
    setPendingKey(null);
    setPendingRecoverCode("");
    setPendingKeyRecovered(false);
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
      authorKind: me.kind,
      content,
      createdAt: Date.now(),
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
      const real = await api.send(conn, content, attachmentIds, replyToId);
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

  const performSignOut = () => {
    clearConn();
    setConn(null);
    setMe(null);
    setMessages([]);
    setMembers([]);
    setSignOutOpen(false);
    setAuthOpen(true);
  };

  // Keep the document title in sync with the active language.
  useEffect(() => {
    document.title = t("app.title");
  }, [t]);

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
          onSignOutRequest={() => setSignOutOpen(true)}
        />
      )}

      <div className="flex min-h-0 flex-1">
        <Roster members={members} selfId={me?.id} onlineIds={onlineIds} />
        <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
          {/* Visually-hidden h1 gives the view a heading for SR users without
              duplicating the visible topbar wordmark. */}
          <h1 className="sr-only">{t("app.h1")}</h1>
          {/* First-load gate. While bootStatus is set we render the boot screen
              (loading spinner OR retryable error) instead of the message list +
              composer, so a server-down on reload never silently wipes the key
              or strands the user in the empty state. Once null, the room shows. */}
          {bootStatus ? (
            <BootScreen status={bootStatus} retryNonce={bootRetryNonce} onRetry={retryBoot} />
          ) : (
            <>
              <SearchBar conn={conn} />
              <MessageList
                ref={messageListRef}
                messages={messages}
                me={me}
                members={members}
                status={status}
                onLoadMore={loadMore}
                loadingMore={loadingMore}
                onReply={setReplyTo}
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
                replyTo={replyTo}
                onReplyClear={() => setReplyTo(null)}
              />
            </>
          )}
        </main>
      </div>

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

      {/* Reveal the freshly-minted (or freshly-recovered) key before persisting
          it. Mutually exclusive with the AuthDialog (authOpen is false while
          this shows), so there's no Radix focus-trap nesting to worry about. */}
      <KeyRevealDialog
        open={!!pendingKey}
        key_={pendingKey ?? ""}
        recoverCode={pendingRecoverCode}
        recovered={pendingKeyRecovered}
        onSaved={handleKeySaved}
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
