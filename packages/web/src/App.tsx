import { useCallback, useEffect, useState } from "react";
import type { Participant } from "@club/shared";
import type { ClubConn } from "@club/sdk";
import { loadConn, saveConn, clearConn, API_URL } from "@/lib/auth";
import { api } from "@/lib/api";
import { useMessageStream } from "@/hooks/use-message-stream";
import { Topbar } from "@/components/topbar";
import { Roster } from "@/components/roster";
import { MessageList } from "@/components/message-list";
import { Composer } from "@/components/composer";
import { AuthDialog } from "@/components/auth-dialog";

export default function App() {
  const [conn, setConn] = useState<ClubConn | null>(() => loadConn());
  const [me, setMe] = useState<Participant | null>(null);
  const [members, setMembers] = useState<Participant[]>([]);
  const [authOpen, setAuthOpen] = useState(!conn);
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

  const handleSend = async (content: string) => {
    if (!conn) return;
    await api.send(conn, content);
    void refreshMembers();
  };

  const handleSignOut = () => {
    clearConn();
    setConn(null);
    setMe(null);
    setMessages([]);
    setMembers([]);
    setAuthOpen(true);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Skip link: first focusable element, lets keyboard/SR users jump to the
          chat. Visually hidden until focused. */}
      <a
        href="#main"
        className="sr-only z-[60] rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-3 focus:top-3"
      >
        Skip to chat
      </a>

      <Topbar
        meName={me?.name ?? null}
        status={status}
        members={members}
        selfId={me?.id}
        onSignOut={handleSignOut}
      />
      <div className="flex min-h-0 flex-1">
        <Roster members={members} selfId={me?.id} />
        <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
          {/* Visually-hidden h1 gives the view a heading for SR users without
              duplicating the visible topbar wordmark. */}
          <h1 className="sr-only">club — #general chat</h1>
          <MessageList messages={messages} me={me} members={members} status={status} booting={booting} />
          <Composer onSend={handleSend} disabled={!me} members={members} selfId={me?.id} />
        </main>
      </div>

      <AuthDialog open={authOpen} onAuthed={handleAuthed} />
    </div>
  );
}