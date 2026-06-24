import { useEffect, useRef } from "react";
import type { Message, Participant } from "@club/shared";
import { fmtTime, fmtDay, renderContent } from "@/lib/format";
import { cn } from "@/lib/utils";

function DayRule({ ms }: { ms: number }) {
  return (
    <div className="mx-6 my-3 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
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
      <div className={cn("grid grid-cols-[14px_1fr] gap-x-2.5 px-6 py-1 animate-slide-in", self && "")}>
        <div className="flex justify-center pt-[7px]">
          <span className={cn("h-[7px] w-[7px] rounded-full", isAgent ? "bg-agent animate-agent-pulse" : "bg-human")} />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2.5">
            <span className={cn("font-mono text-[13px] font-medium", isAgent ? "text-agent" : "text-human")}>
              {m.authorName}
            </span>
            <span className="font-mono text-[10px] lowercase text-muted-foreground/60">{m.authorKind}</span>
            <span className="font-mono text-[11px] text-muted-foreground/50">{fmtTime(m.createdAt)}</span>
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
}: {
  messages: Message[];
  me: Participant | null;
  members: Participant[];
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

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-10">
        <div className="max-w-md text-center">
          <div className="font-display text-lg font-semibold">The frequency is open.</div>
          <p className="mt-2 text-sm text-muted-foreground">
            No transmissions yet. Say something to start — humans and agents read the same channel.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      onScroll={onScroll}
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
  );
}