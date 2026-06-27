import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import type { Message, Participant } from "@club/shared";
import { fmtTime, fmtDay, renderContent, mentionsSelf } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Status = "connecting" | "connected" | "lost";

function DayRule({ ms }: { ms: number }) {
  const { locale, t } = useI18n();
  return (
    <div className="mx-6 my-3 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/85">
      <span className="h-px flex-1 bg-border/60" />
      {fmtDay(ms, locale, t("date.today"))}
      <span className="h-px flex-1 bg-border/60" />
    </div>
  );
}

function MessageRow({
  m,
  self,
  known,
  selfName,
  showDay,
}: {
  m: Message;
  self: boolean;
  known: string[];
  selfName?: string;
  showDay: boolean;
}) {
  const { locale, t } = useI18n();
  const isAgent = m.authorKind === "agent";
  const pinged = mentionsSelf(m.content, selfName);
  // Bubble + alignment scheme (the standard chat-app mental model):
  //   - own messages: right-aligned, body in a mint-tinted bubble (bg-primary/15)
  //   - others: left-aligned, body in a raised-surface bubble (bg-card)
  // The author kind dot moves to the leading edge of the bubble in both cases
  // (i.e. on the right for self, on the left for others) via flex-row-reverse,
  // so it never sits awkwardly on the wrong side after alignment flips.
  // When a row pings the current user, the whole row gets a faint primary wash
  // + a left accent bar so it stands out at a glance even while scrolling.
  return (
    <>
      {showDay && <DayRule ms={m.createdAt} />}
      <div
        className={cn(
          "flex gap-x-2.5 rounded-md px-6 py-1.5 animate-slide-in transition-colors hover:bg-accent/70",
          self && "flex-row-reverse",
          pinged && "border-l-2 border-l-primary/40 bg-primary/5",
        )}
      >
        <div className={cn("flex justify-center pt-[7px]", self && "flex-row-reverse")}>
          <span
            aria-hidden
            className={cn("h-[7px] w-[7px] rounded-full", isAgent ? "bg-agent animate-agent-pulse" : "bg-human")}
          />
        </div>
        <div className={cn("min-w-0 flex-1", self && "flex flex-col items-end")}>
          <div
            className={cn(
              "flex flex-wrap items-baseline gap-x-2.5",
              self && "flex-row-reverse",
            )}
          >
            <span className={cn("font-mono text-[13px] font-medium", isAgent ? "text-agent" : "text-human")}>
              {m.authorName}
            </span>
            <span className="font-mono text-[10px] lowercase text-muted-foreground/90">
              {m.authorKind === "agent" ? t("msg.kindAgent") : t("msg.kindHuman")}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground/90">{fmtTime(m.createdAt, locale)}</span>
          </div>
          <div
            className={cn(
              "mt-0.5 max-w-[min(100%,44ch)] whitespace-pre-wrap break-words rounded-lg px-3 py-1.5 leading-snug",
              self ? "bg-primary/15 text-foreground" : "bg-card text-foreground",
            )}
          >
            {renderContent(m.content, known, selfName)}
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
  booting,
}: {
  messages: Message[];
  me: Participant | null;
  members: Participant[];
  status: Status;
  booting?: boolean;
}) {
  const { locale, t } = useI18n();
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
        className="flex flex-none items-center justify-center gap-2 border-b border-destructive/30 border-l-2 border-l-destructive bg-destructive/15 px-4 py-1.5 font-mono text-[11px] text-destructive animate-in slide-in-from-top-2 duration-300"
      >
        <AlertTriangle className="h-3.5 w-3.5 animate-pulse" aria-hidden />
        {t("msg.disconnected")}
      </div>
    ) : null;

  if (booting) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {banner}
        <div className="flex flex-1 items-center justify-center p-10">
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground/85"
          >
            <span className="h-2 w-2 rounded-full bg-agent animate-agent-pulse" aria-hidden />
            {t("msg.connecting")}
          </div>
        </div>
      </div>
    );
  }
  if (messages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {banner}
        <div className="flex flex-1 items-center justify-center p-10">
          <div className="max-w-xs text-center">
            <div className="font-display text-2xl font-semibold tracking-tight">{t("msg.empty.title")}</div>
            <div className="mx-auto mt-3 h-px w-8 bg-agent/60" aria-hidden />
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {t("msg.empty.body")}
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
        aria-label={t("msg.logLabel")}
        aria-live="polite"
        aria-relevant="additions"
        // Make the scroll region keyboard-focusable (WCAG 2.1.1 + axe
        // `scrollable-region-focusable`): without tabindex, keyboard-only users
        // can't bring the log into focus to arrow-scroll through history.
        tabIndex={0}
        className="flex-1 overflow-y-auto py-5 scrollbar-thin outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/40"
        style={{
          backgroundImage: "radial-gradient(900px 360px at 78% -8%, hsl(var(--agent-soft)), transparent 70%)",
        }}
      >
        {messages.map((m) => {
          const day = fmtDay(m.createdAt, locale, t("date.today"));
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <MessageRow
              key={m.id}
              m={m}
              self={!!me && m.participantId === me.id}
              known={known}
              selfName={me?.name}
              showDay={showDay}
            />
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}