import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import type { Message, Participant } from "@club/shared";
import { fmtTime, fmtDay, renderContent } from "@/lib/format";
import { cn } from "@/lib/utils";

type Status = "connecting" | "connected" | "lost";

function DayRule({ ms }: { ms: number }) {
  return (
    <div className="mx-6 my-3 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/85">
      <span className="h-px flex-1 bg-border/60" />
      {fmtDay(ms)}
      <span className="h-px flex-1 bg-border/60" />
    </div>
  );
}

function MessageRow({
  m,
  self,
  known,
  showDay,
}: {
  m: Message;
  self: boolean;
  known: string[];
  showDay: boolean;
}) {
  const isAgent = m.authorKind === "agent";
  return (
    <>
      {showDay && <DayRule ms={m.createdAt} />}
      <div className={cn("grid grid-cols-[14px_1fr] gap-x-2.5 rounded-md px-6 py-1 animate-slide-in transition-colors hover:bg-accent/40", self && "")}>
        <div className="flex justify-center pt-[7px]">
          <span className={cn("h-[7px] w-[7px] rounded-full", isAgent ? "bg-agent animate-agent-pulse" : "bg-human")} />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2.5">
            <span className={cn("font-mono text-[13px] font-medium", isAgent ? "text-agent" : "text-human")}>
              {m.authorName}
            </span>
            <span className="font-mono text-[10px] lowercase text-muted-foreground/90">{m.authorKind}</span>
            <span className="font-mono text-[11px] text-muted-foreground/90">{fmtTime(m.createdAt)}</span>
          </div>
          <div className={cn("whitespace-pre-wrap break-words pb-0.5", self ? "text-foreground" : "text-foreground/90")}>
            {renderContent(m.content, known)}
          </div>
        </div>
      </div>
    </>
  );
}

export function MessageList({
  messages,
  me,
  members,
  status,
}: {
  messages: Message[];
  me: Participant | null;
  members: Participant[];
  status: Status;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  // track whether the user is pinned to the bottom (don't auto-scroll if they scrolled up)
  const onScroll = () => {
    const el = wrapRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    if (atBottomRef.current) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const known = [...members.map((m) => m.name), me?.name].filter(Boolean) as string[];
  let lastDay = "";

  // Sticky inline banner shown when the live stream has dropped, so users know
  // sends/receives may be interrupted even if they missed the topbar dot.
  const banner =
    status === "lost" ? (
      <div
        role="status"
        className="flex flex-none items-center justify-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-1.5 font-mono text-[11px] text-destructive"
      >
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        connection lost — retrying
      </div>
    ) : null;

  if (messages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {banner}
        <div className="flex flex-1 items-center justify-center p-10">
          <div className="max-w-md text-center">
            <div className="font-display text-lg font-semibold">The frequency is open.</div>
            <p className="mt-2 text-sm text-muted-foreground">
              No transmissions yet. Say something to start — humans and agents read the same channel.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {banner}
      <div
        ref={wrapRef}
        onScroll={onScroll}
        // role=log + aria-live turns this into a live region so screen-reader
        // users hear new messages arrive without leaving the composer. The
        // visible label is hidden but names the region for SR navigation.
        role="log"
        aria-label="Messages in #general"
        aria-live="polite"
        aria-relevant="additions"
        className="flex-1 overflow-y-auto py-5 scrollbar-thin"
        style={{
          backgroundImage: "radial-gradient(900px 360px at 78% -8%, hsl(var(--agent-soft)), transparent 70%)",
        }}
      >
        {messages.map((m) => {
          const day = fmtDay(m.createdAt);
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <MessageRow key={m.id} m={m} self={!!me && m.participantId === me.id} known={known} showDay={showDay} />
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}