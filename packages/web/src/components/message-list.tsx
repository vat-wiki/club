import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Message, MessageAttachment, Participant } from "@club/shared";
import { fmtTime, fmtTimePrecise, fmtDay, renderContent, mentionsSelf } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ImageLightbox } from "@/components/image-lightbox";
import { Avatar } from "@/components/avatar";

type Status = "connecting" | "connected" | "lost";

// Resolve a root-relative attachment url (e.g. "/files/abc") against the
// current origin so <img src> works in dev (Vite proxy) and prod (same-origin).
// Falls back to the bare url when no window (SSR/test safety).
function resolveUrl(url: string): string {
  if (typeof window === "undefined") return url;
  if (/^https?:\/\//i.test(url)) return url;
  return `${window.location.origin}${url.startsWith("/") ? "" : "/"}${url}`;
}

// Inline image gallery rendered inside the bubble (design §3). Single image:
// a 4/3 thumbnail capped at 320px; multiple: a 2-col grid of square thumbs.
// Rounded-md (one step smaller than the bubble's rounded-lg) to read as
// "image < bubble". Clicking any thumb opens the shared ImageLightbox at full
// size. Thumbnails shimmer (animate-shimmer) until onLoad to avoid a white
// flash. Each thumb is a <button> (keyboard-reachable lightbox trigger) with a
// descriptive aria-label.
function AttachmentGallery({
  attachments,
  openLabel,
}: {
  attachments: MessageAttachment[];
  openLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const multi = attachments.length > 1;
  const activeSrc = active != null ? resolveUrl(attachments[active].url) : "";

  return (
    <>
      <div className={cn("mt-1.5 w-full max-w-[320px]", multi ? "grid grid-cols-2 gap-1" : "")}>
        {attachments.map((a, i) => {
          // Video attachments render as an inline <video controls> — the native
          // player handles play/seek/fullscreen, so they don't enter the image
          // lightbox. preload="metadata" fetches just enough to show the
          // duration and first frame without buffering the whole file up front,
          // and exercises the server's Range support as soon as the user scrubs.
          if (a.mime.startsWith("video/")) {
            return (
              <div
                key={a.id}
                data-testid={`attachment-video-${i}`}
                className={cn(
                  "mt-1.5 w-full max-w-[360px] overflow-hidden rounded-md border border-border/60 bg-black",
                  multi && "col-span-2",
                )}
              >
                <video
                  src={resolveUrl(a.url)}
                  controls
                  preload="metadata"
                  playsInline
                  className="aspect-video w-full bg-black"
                />
              </div>
            );
          }
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`${openLabel} ${i + 1}`}
              data-testid={`attachment-thumb-${i}`}
              className={cn(
                // A real min size so a tiny (e.g. 1×1 test) image can't collapse
                // to an invisible dot: min-h-10 (40px) floors the height and the
                // aspect ratio sets the width. object-cover (on the <img>) crops
                // extreme aspect ratios (>10:1) into the fixed frame instead of a
                // thin sliver. cursor-zoom-in signals the click-to-enlarge affordance.
                "group/img relative overflow-hidden rounded-md border border-border/60 bg-muted transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-zoom-in min-h-10",
                multi ? "aspect-square" : "aspect-[4/3]",
              )}
            >
              <img
                src={resolveUrl(a.url)}
                alt=""
                // Loading shimmer until the bytes arrive; on load the image fades
                // in over the shimmering placeholder. The infinite shimmer is
                // collapsed to a single frame under prefers-reduced-motion
                // (global wildcard in index.css).
                loading="lazy"
                draggable={false}
                onLoad={(e) => {
                  e.currentTarget.classList.remove("opacity-0");
                }}
                className="h-full w-full bg-gradient-to-r from-muted via-accent/40 to-muted bg-[length:200%_100%] object-cover opacity-0 animate-shimmer transition-opacity duration-200"
              />
            </button>
          );
        })}
      </div>
      <ImageLightbox
        src={activeSrc}
        alt={openLabel}
        open={active != null}
        onOpenChange={(o) => {
          if (!o) setActive(null);
        }}
      />
    </>
  );
}

// Imperative handle exposed via the MessageList ref. `scrollToBottom` re-pins
// the list to the latest message — but only when the user was already pinned
// to the bottom, so it never yanks someone who scrolled up to read history.
export type MessageListHandle = {
  scrollToBottomIfPinned: () => void;
};

type MessageListProps = {
  messages: Message[];
  me: Participant | null;
  members: Participant[];
  status: Status;
  onLoadMore?: () => Promise<boolean> | void;
  loadingMore?: boolean;
  onReply?: (m: Message) => void;
  onDelete?: (id: string) => void;
  onReact?: (messageId: string, emoji: string) => void;
};

// A flattened virtual item: either a day separator or a message row. Day
// separators are first-class items so the virtualizer spaces them independently
// of message rows (the row no longer renders its own DayRule).
// The fixed emoji palette offered on each message (keeps the UI simple; the
// contract allows any short string).
const REACTION_EMOJIS = ["👍", "❤️", "😂"] as const;

type Item =
  | { kind: "day"; ms: number; key: string }
  | { kind: "msg"; m: Message; self: boolean; grouped: boolean; replyTo?: Message; key: string };

function DayRule({ ms }: { ms: number }) {
  const { locale, t } = useI18n();
  return (
    <div className="mx-4 my-3 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/85 sm:mx-6">
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
  grouped,
  onReply,
  replyTo,
  onDelete,
  onReact,
}: {
  m: Message;
  self: boolean;
  known: string[];
  selfName?: string;
  showDay: boolean;
  // True when this message continues a run from the same author within the
  // grouping window (see GROUP_GAP_MS). In that case the per-message header
  // (author name + kind + time) is suppressed — Slack/iMessage style — so a
  // burst reads as one block instead of repeating the header on every line.
  // The exact send time is still reachable via the row's hover title.
  grouped?: boolean;
  /** Click "reply" → enter composer reply mode quoting this message. */
  onReply?: (m: Message) => void;
  /** The message this one replies to (quote preview), if known locally. */
  replyTo?: Message;
  /** Recall (delete) this message — only callable on the author's own rows. */
  onDelete?: (id: string) => void;
  /** Toggle an emoji reaction on this message. */
  onReact?: (messageId: string, emoji: string) => void;
}) {
  const { locale, t } = useI18n();
  const isAgent = m.authorKind === "agent";
  const pinged = mentionsSelf(m.content, selfName);
  // The precise (to-the-second) time, surfaced on hover via the native title
  // tooltip AND as the row's accessible description (aria-label) so SR users get
  // the exact time without hovering. The inline header timestamp stays HH:MM.
  const preciseTime = fmtTimePrecise(m.createdAt, locale);
  const sentAtLabel = t("msg.sentAt", { time: preciseTime });
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
        // Native title tooltip carries the precise send time; aria-label gives
        // SR users the same info (the inline HH:MM + author are already in the
        // row's text content, so the label focuses on the time precision).
        title={sentAtLabel}
        aria-label={sentAtLabel}
        className={cn(
          // grouped rows tighten their top padding (no header to space under)
          // and drop the hover bg so a run reads as one continuous block.
          "flex gap-x-2.5 rounded-md px-4 animate-slide-in transition-colors hover:bg-accent/70 sm:px-6",
          grouped ? "pt-0.5 pb-1.5" : "py-1.5",
          self && "flex-row-reverse",
          pinged && "border-l-2 border-l-primary/40 bg-primary/5",
        )}
      >
        <div className={cn("flex justify-center pt-1", self && "flex-row-reverse")}>
          {/* First-letter avatar tinted by name. On grouped rows it's invisible
              (opacity-0) but kept for column alignment — the header above already
              names the author, so a repeat would be noise. */}
          <Avatar name={m.authorName} className={cn("h-6 w-6 text-[10px]", grouped && "opacity-0")} />
        </div>
        <div className={cn("min-w-0 flex-1", self && "flex flex-col items-end")}>
          {/* Header (author + kind + HH:MM) only on the FIRST row of a run. */}
          {!grouped && (
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
              {onReply && (
                <button
                  type="button"
                  onClick={() => onReply(m)}
                  className="font-mono text-[10px] lowercase text-muted-foreground/50 transition-colors hover:text-foreground"
                >
                  {t("msg.reply")}
                </button>
              )}
              {self && !m.deleted && !m.status && onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(m.id)}
                  className="font-mono text-[10px] lowercase text-muted-foreground/50 transition-colors hover:text-destructive"
                >
                  {t("msg.recall")}
                </button>
              )}
            </div>
          )}
          <div
            className={cn(
              "max-w-[85%] sm:max-w-[70%] md:max-w-[min(100%,60ch)] lg:max-w-[min(100%,72ch)] whitespace-pre-wrap break-words rounded-lg px-3 py-1.5 leading-snug",
              self ? "bg-primary/15 text-foreground" : "bg-card text-foreground",
              grouped ? "mt-0" : "mt-0.5",
              m.status === "sending" && "opacity-60",
              m.status === "failed" && "border border-destructive/50 bg-destructive/10",
            )}
          >
            {m.replyToId && (
              <div className="mb-1 border-l-2 border-border/60 pl-2 text-xs text-muted-foreground">
                {replyTo ? (
                  <span className="truncate">
                    <span className="font-medium">{replyTo.authorName}</span>: {replyTo.content.slice(0, 80) || "…"}
                  </span>
                ) : (
                  t("msg.replyNotFound")
                )}
              </div>
            )}
            {m.deleted ? (
              <span className="italic text-muted-foreground">{t("msg.recalled")}</span>
            ) : (
              <>
                {m.content.length > 0 && renderContent(m.content, known, selfName)}
                {m.attachments && m.attachments.length > 0 && (
                  <AttachmentGallery attachments={m.attachments} openLabel={t("msg.image.open")} />
                )}
              </>
            )}
            {m.status === "sending" && (
              <span className="ml-1 inline-flex items-center gap-1 align-middle font-mono text-[10px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                {t("msg.sending")}
              </span>
            )}
            {m.status === "failed" && (
              <span className="mt-1 flex items-center gap-1 font-mono text-[10px] text-destructive">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                {t("msg.sendFailed")}
              </span>
            )}
          </div>
          {!m.deleted && (onReact || (m.reactions && m.reactions.length > 0)) && (
            <div className={cn("mt-1 flex flex-wrap items-center gap-1", self && "justify-end")}>
              {m.reactions?.map((r) => (
                <span
                  key={r.emoji}
                  className="inline-flex items-center gap-0.5 rounded-full bg-accent px-1.5 py-0.5 text-[11px]"
                >
                  {r.emoji}
                  <span className="tabular-nums text-muted-foreground">{r.count}</span>
                </span>
              ))}
              {onReact &&
                REACTION_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => onReact(m.id, emoji)}
                    aria-label={t("msg.react")}
                    className="rounded px-1 py-0.5 text-xs hover:bg-accent"
                  >
                    {emoji}
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export const MessageList = forwardRef<MessageListHandle, MessageListProps>(function MessageList(
  { messages, me, members, status, onLoadMore, loadingMore, onReply, onDelete, onReact },
  ref,
) {
  const { locale, t } = useI18n();
  const wrapRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  // Mirror loadingMore into a ref so the scroll handler reads the latest value
  // without re-subscribing, and never fires a second load while one's in flight.
  const loadingMoreRef = useRef(false);
  loadingMoreRef.current = !!loadingMore;
  // scrollHeight captured the moment we request more history; the post-load
  // effect adds the growth delta to scrollTop so the viewport stays on the same
  // message instead of jumping to the newly-loaded top.
  const prevScrollHeightRef = useRef(0);

  const known = [...members.map((m) => m.name), me?.name].filter(Boolean) as string[];
  const selfName = me?.name;
  // Grouping window: consecutive messages from the same author within this gap
  // merge into one run (header shown only on the first). 5 min is the common
  // chat-app threshold — short enough that a resumed conversation re-shows the
  // header, long enough that a rapid burst reads as a block.
  const GROUP_GAP_MS = 5 * 60 * 1000;

  // Flatten messages + day separators into one virtual-item list. Day
  // separators are first-class items so the virtualizer spaces them
  // independently of message rows; the row no longer renders its own DayRule.
  const items = useMemo<Item[]>(() => {
    const replyMap = new Map(messages.map((m) => [m.id, m]));
    const out: Item[] = [];
    let lastDay = "";
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const day = fmtDay(m.createdAt, locale, t("date.today"));
      const showDay = day !== lastDay;
      if (showDay) {
        out.push({ kind: "day", ms: m.createdAt, key: `day-${i}` });
        lastDay = day;
      }
      const prev = messages[i - 1];
      const grouped =
        !showDay &&
        !!prev &&
        prev.participantId === m.participantId &&
        m.createdAt - prev.createdAt <= GROUP_GAP_MS;
      out.push({
        kind: "msg",
        m,
        self: !!me && m.participantId === me.id,
        grouped,
        replyTo: m.replyToId ? replyMap.get(m.replyToId) : undefined,
        key: m.id,
      });
    }
    return out;
  }, [messages, me, locale, t]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => wrapRef.current,
    estimateSize: (i) => (items[i]?.kind === "day" ? 36 : 56),
    overscan: 10,
  });

  // Expose a "scroll to bottom, but only if already pinned" command so callers
  // (e.g. the visual-viewport keyboard handler) can re-pin the list after the
  // visible area shrinks.
  useImperativeHandle(
    ref,
    () => ({
      scrollToBottomIfPinned: () => {
        if (!atBottomRef.current || items.length === 0) return;
        virtualizer.scrollToIndex(items.length - 1, { align: "end", behavior: "smooth" });
      },
    }),
    [virtualizer, items.length],
  );

  // Auto-stick to the bottom when a new message arrives (if the user was
  // already pinned there). Replaces the old bottomRef scrollIntoView effect.
  useEffect(() => {
    if (atBottomRef.current && items.length > 0) {
      virtualizer.scrollToIndex(items.length - 1, { align: "end" });
    }
  }, [items.length, virtualizer]);

  // After a load-more prepend, restore the viewport: shift scrollTop down by the
  // pixels the list grew so the message the user was reading stays put.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || prevScrollHeightRef.current === 0) return;
    const delta = el.scrollHeight - prevScrollHeightRef.current;
    if (delta > 0) el.scrollTop += delta;
    prevScrollHeightRef.current = 0;
  }, [items.length]);

  // Track pinned-to-bottom AND trigger scroll-up pagination near the top.
  const onScroll = () => {
    const el = wrapRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 80 && !loadingMoreRef.current && onLoadMore) {
      prevScrollHeightRef.current = el.scrollHeight;
      void onLoadMore();
    }
  };

  // Sticky inline banner shown when the live stream has dropped, so users know
  // sends/receives may be interrupted even if they missed the topbar dot.
  const banner =
    status === "lost" ? (
      <div
        role="status"
        className="flex flex-none items-center justify-center gap-2 border-b border-destructive/30 border-l-2 border-l-destructive bg-destructive/15 px-4 py-1.5 font-mono text-[11px] text-destructive animate-in slide-in-from-top-2 duration-slow"
      >
        <AlertTriangle className="h-3.5 w-3.5 animate-pulse" aria-hidden />
        {t("msg.disconnected")}
      </div>
    ) : null;

  if (messages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {banner}
        <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
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

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {banner}
      {loadingMore && (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-none items-center justify-center gap-1.5 border-b border-border/40 py-1.5 font-mono text-[10px] text-muted-foreground"
        >
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          {t("msg.loadingMore")}
        </div>
      )}
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
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualItems.map((vi) => {
            const item = items[vi.index];
            if (!item) return null;
            return (
              <div
                key={item.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                {item.kind === "day" ? (
                  <DayRule ms={item.ms} />
                ) : (
                  <MessageRow
                    m={item.m}
                    self={item.self}
                    known={known}
                    selfName={selfName}
                    showDay={false}
                    grouped={item.grouped}
                    onReply={onReply}
                    replyTo={item.replyTo}
                    onDelete={onDelete}
                    onReact={onReact}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});