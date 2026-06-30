import { useCallback, useEffect, useRef, useState } from "react";
import type { Participant } from "@club/shared";
import type { ClubConn } from "@club/sdk";
import { loadConn, saveConn, clearConn, API_URL, getKey } from "@/lib/auth";
import { api } from "@/lib/api";
import { useMessageStream } from "@/hooks/use-message-stream";
import { useVisualViewportHeight } from "@/hooks/use-visual-viewport-height";
import { useI18n } from "@/lib/i18n";
import { Topbar } from "@/components/topbar";
import { Roster } from "@/components/roster";
import { MessageList, type MessageListHandle } from "@/components/message-list";
import { Composer } from "@/components/composer";
import { AuthDialog } from "@/components/auth-dialog";
import { KeyRevealDialog } from "@/components/key-reveal-dialog";
import { SignOutConfirmDialog } from "@/components/sign-out-confirm-dialog";

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
  const [signOutOpen, setSignOutOpen] = useState(false);
  // True between having a stored key and the first batch of history landing —
  // shows a loading state instead of flashing the empty state prematurely.
  const [booting, setBooting] = useState(!!conn);

  const { messages, status, setMessages } = useMessageStream(me ? conn : null);

  const refreshMembers = useCallback(async () => {
    if (!conn) return;
    try {
      setMembers(await api.members(conn));
    } catch {
      /* transient */
    }
  }, [conn]);

  // boot: validate stored key
  useEffect(() => {
    if (!conn) return;
    setBooting(true);
    let cancelled = false;
    (async () => {
      try {
        const m = await api.me(conn);
        if (cancelled) return;
        setMe(m);
        setAuthOpen(false);
        const history = await api.messages(conn);
        if (cancelled) return;
        setMessages(history);
        setBooting(false);
        void refreshMembers();
      } catch {
        if (cancelled) return;
        setBooting(false);
        clearConn();
        setConn(null);
        setAuthOpen(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conn, setMessages, refreshMembers]);

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
  };

  const handleKeySaved = () => {
    if (!pendingKey) return;
    handleAuthed(pendingKey);
    setPendingKey(null);
    setPendingRecoverCode("");
  };

  const handleSend = async (content: string) => {
    if (!conn) return;
    await api.send(conn, content);
    void refreshMembers();
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
          key_={getKey()}
          onSignOutRequest={() => setSignOutOpen(true)}
        />
      )}

      <div className="flex min-h-0 flex-1">
        <Roster members={members} selfId={me?.id} />
        <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
          {/* Visually-hidden h1 gives the view a heading for SR users without
              duplicating the visible topbar wordmark. */}
          <h1 className="sr-only">{t("app.h1")}</h1>
          <MessageList
            ref={messageListRef}
            messages={messages}
            me={me}
            members={members}
            status={status}
            booting={booting}
          />
          <Composer onSend={handleSend} disabled={!me} members={members} selfId={me?.id} />
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
      />

      {/* Reveal the freshly-minted key before persisting it. Mutually
          exclusive with the AuthDialog (authOpen is false while this shows),
          so there's no Radix focus-trap nesting to worry about. */}
      <KeyRevealDialog
        open={!!pendingKey}
        key_={pendingKey ?? ""}
        recoverCode={pendingRecoverCode}
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
