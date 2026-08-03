import { Avatar, avatarColor } from "@/components/avatar";
import { EmojiPicker } from "@/components/emoji-picker";
import { FileCard } from "@/components/file-card";
import { ImageLightbox } from "@/components/image-lightbox";
import { Button } from "@/components/ui/button";
import { fmtDay, fmtTime, fmtTimePrecise, mentionsSelf,renderContent,sanitizeDisplayString } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, Loader2, Pencil, Reply, Trash2 } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

import type { Message, MessageAttachment, Participant } from "@club/shared";

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
  // Only image attachments enter the lightbox (videos use the native player,
  // documents use FileCard). Precompute the image subset + a per-attachment
  // index map so each thumbnail — keyed by its position in the full attachment
  // list (which the tests assert via data-testid) — can tell the lightbox which
  // image to open, and the lightbox can prev/next across just the images.
  const images: MessageAttachment[] = [];
  const imageIndexOf: number[] = [];
  for (const a of attachments) {
    if (a.mime.startsWith("image/")) {
      imageIndexOf.push(images.length);
      images.push(a);
    } else {
      imageIndexOf.push(-1);
    }
  }
  const [active, setActive] = useState<number | null>(null);
  const multi = attachments.length > 1;

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
          if (!a.mime.startsWith("image/")) {
            // Document attachment (pdf/docx/xlsx/md) → compact file card with
            // download (+ native PDF preview in a new tab).
            return <FileCard key={a.id} attachment={a} />;
          }
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => setActive(imageIndexOf[i])}
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
        images={images.map((a) => ({ src: resolveUrl(a.url), alt: openLabel }))}
        index={active}
        onIndexChange={setActive}
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
  /** Slug of the focused channel — drives the empty-state + log-region labels. */
  channel?: string;
  /** True while a channel's initial history is being fetched (switch=换台). Shows a
   *  shimmer skeleton so the area never flashes empty-then-pop. */
  loadingChannel?: boolean;
  /** A message id to scroll to + briefly highlight (cross-channel @mention deep-link). */
  highlightMessageId?: string | null;
  /** Cleared by the caller after the highlight lands (so it doesn't re-fire). */
  onHighlightConsumed?: () => void;
  onLoadMore?: () => Promise<boolean> | void;
  loadingMore?: boolean;
  onReply?: (m: Message) => void;
  onDelete?: (id: string) => void;
  /** Undo a pending recall inside the 5s window (before the API delete fires). */
  onUndoRecall?: (id: string) => void;
  /** Ids of the current user's messages mid-recall (showing the undo placeholder). */
  pendingRecalls?: Set<string>;
  /** Edit one of the current user's own messages (inline edit UI). */
  onEdit?: (id: string, content: string) => Promise<void>;
  onReact?: (messageId: string, emoji: string) => void;
  /** Jump to + highlight a message (used by reply-quote clicks to scroll to the
   *  original). Reuses the highlightMessageId scroll/around mechanism. */
  onJumpTo?: (id: string) => void;
  /** Fired when a highlight target isn't in the loaded history window; the
   *  caller fetches context via messages({ around: id }) so the target can be
   *  scrolled to + highlighted (G6 deep-link). */
  onNeedAround?: (id: string) => void;
};

// A flattened virtual item: either a day separator or a message row. Day
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

// Unified hover/tap action toolbar for a message: react (emoji palette),
// reply, edit (own), recall (own). Replaces the old scattered header text
// buttons + the duplicated inline reaction buttons, so every per-message
// action lives in one discoverable place.
//
// Visibility: faded in by the parent MessageRow via `group-hover/msg` +
// `focus-within` (keyboard) on desktop, and by a `pressed` flag (row tap) on
// touch devices where hover doesn't exist. Each button is icon-only, so every
// one carries an aria-label (the a11y suite asserts this with callbacks wired).
function MessageActions({
  m,
  self,
  pressed,
  onReply,
  onEdit,
  onDelete,
  onReact,
  startEdit,
}: {
  m: Message;
  self: boolean;
  /** Touch toggle: forces the toolbar visible on tap (no hover on touch). */
  pressed: boolean;
  onReply?: (m: Message) => void;
  onEdit?: (id: string, content: string) => Promise<void>;
  onDelete?: (id: string) => void;
  onReact?: (messageId: string, emoji: string) => void;
  startEdit: () => void;
}) {
  const { t } = useI18n();
  const canEdit = self && onEdit;
  const canRecall = self && onDelete;
  // Nothing to show if no callbacks at all (e.g. read-only / a11y render w/o handlers).
  if (!onReply && !canEdit && !canRecall && !onReact) return null;
  return (
    <div
      // `pressed` (touch) OR group-hover/focus-within (desktop) reveals the bar.
      // pointer-events-none while hidden so it never blocks the bubble, but
      // auto when visible so the buttons are clickable. stopPropagation keeps
      // toolbar clicks from bubbling to the row's tap-to-toggle handler.
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "pointer-events-none absolute top-0 z-10 flex items-center gap-0.5 rounded-lg border border-border/60 bg-card/95 p-0.5 shadow-sm backdrop-blur transition-opacity duration-fast",
        self ? "left-0" : "right-0",
        pressed ? "pointer-events-auto opacity-100" : "opacity-0 group-hover/msg:pointer-events-auto group-hover/msg:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100",
      )}
    >
      {onReact && <EmojiPicker messageId={m.id} reactions={m.reactions} onReact={onReact} />}
      {onReply && (
        <button
          type="button"
          data-testid={`reply-${m.id}`}
          onClick={() => onReply(m)}
          aria-label={t("msg.reply")}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Reply className="h-4 w-4" />
        </button>
      )}
      {canEdit && (
        <button
          type="button"
          data-testid={`edit-${m.id}`}
          onClick={startEdit}
          aria-label={t("msg.edit")}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Pencil className="h-4 w-4" />
        </button>
      )}
      {canRecall && (
        <button
          type="button"
          data-testid={`recall-${m.id}`}
          onClick={() => onDelete?.(m.id)}
          aria-label={t("msg.recall")}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// Inline reply-quote shown inside a bubble when a message is a reply. The left
// bar is tinted with the original author's avatar hue (visual association), and
// clicking the quote jumps to + highlights the original message. When no jump
// handler is wired, it degrades to a plain non-interactive quote.
function QuoteBar({
  replyTo,
  replyToId,
  onJumpTo,
  recalledLabel,
  notFoundLabel,
  jumpLabel,
}: {
  replyTo?: Message;
  replyToId?: string;
  onJumpTo?: (id: string) => void;
  recalledLabel: string;
  notFoundLabel: string;
  jumpLabel: string;
}) {
  const barColor = replyTo ? avatarColor(replyTo.authorName) : "var(--border)";
  const body = replyTo ? (
    replyTo.deleted ? (
      <span className="italic">{recalledLabel}</span>
    ) : (
      <span className="truncate">
        <span className="font-medium">{sanitizeDisplayString(replyTo.authorName)}</span>: {sanitizeDisplayString(replyTo.content).slice(0, 80) || "…"}
      </span>
    )
  ) : (
    <span className="italic">{notFoundLabel}</span>
  );
  const cls = "mb-1 flex max-w-full items-center gap-1.5 border-l-2 pl-2 text-xs text-muted-foreground";
  if (!onJumpTo || !replyToId) {
    return <div className={cls} style={{ borderLeftColor: barColor }}>{body}</div>;
  }
  return (
    <button
      type="button"
      data-testid={`quote-jump-${replyToId}`}
      onClick={() => onJumpTo(replyToId)}
      aria-label={jumpLabel}
      className={cn(cls, "text-left transition-colors hover:text-foreground")}
      style={{ borderLeftColor: barColor }}
    >
      {body}
    </button>
  );
}

function MessageRow({
  m,
  self,
  known,
  selfName,
  showDay,
  grouped,
  highlighted,
  canHover,
  onReply,
  replyTo,
  onDelete,
  onUndoRecall,
  pendingRecalls,
  onEdit,
  onReact,
  onJumpTo,
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
  /** Briefly tinted after a cross-channel @mention deep-link lands here. */
  highlighted?: boolean;
  /** Whether the device supports hover (desktop). When false (touch), the
   *  action toolbar is revealed by tapping the row (pressed) instead of hover. */
  canHover?: boolean;
  /** Click "reply" → enter composer reply mode quoting this message. */
  onReply?: (m: Message) => void;
  /** The message this one replies to (quote preview), if known locally. */
  replyTo?: Message;
  /** Recall (delete) this message — only callable on the author's own rows. */
  onDelete?: (id: string) => void;
  /** Undo a pending recall inside the 5s window. */
  onUndoRecall?: (id: string) => void;
  /** Ids mid-recall (showing the undo placeholder). */
  pendingRecalls?: Set<string>;
  /** Edit this message's text — only callable on the author's own rows.
   *  Resolves on success (the caller swaps the message locally); rejects on
   *  server error so the inline editor can surface it and keep editing. */
  onEdit?: (id: string, content: string) => Promise<void>;
  /** Toggle an emoji reaction on this message. */
  onReact?: (messageId: string, emoji: string) => void;
  /** Jump to + highlight a message (reply-quote click -> original). */
  onJumpTo?: (id: string) => void;
}) {
  const { locale, t } = useI18n();
  const pinged = mentionsSelf(m.content, selfName);
  // Inline edit state (own messages only). Local to the row: entering edit mode
  // swaps the bubble content for a <textarea> pre-filled with the message text;
  // Save calls onEdit (which PATCHes and swaps the message locally), Cancel /
  // Escape reverts. The empty/whitespace case is caught client-side; a server
  // rejection surfaces as an inline error and keeps editing.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  // Touch-only: tapping the row toggles the action toolbar open (no hover on
  // touch). Ignored on hover-capable devices, where group-hover reveals it.
  const [pressed, setPressed] = useState(false);

  // If the message is deleted via SSE while the user is editing it, exit edit
  // mode - otherwise the edit/recall buttons stay hidden (they're gated on
  // !m.deleted && !editing) and the user can't dismiss the now-stale editor.
  useEffect(() => {
    if (m.deleted) setEditing(false);
  }, [m.deleted]);

  const startEdit = () => {
    setDraft(m.content);
    setEditError(null);
    setEditing(true);
    requestAnimationFrame(() => {
      const el = editRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
    });
  };
  const cancelEdit = () => {
    setEditing(false);
    setEditError(null);
  };
  const saveEdit = async () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setEditError(t("msg.editEmpty"));
      return;
    }
    if (trimmed === m.content) {
      setEditing(false);
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      await onEdit?.(m.id, trimmed);
      setEditing(false);
    } catch {
      setEditError(t("msg.editFailed"));
    } finally {
      setEditSaving(false);
    }
  };
  // The precise (to-the-second) time, surfaced on hover via the native title
  // tooltip AND as the row's accessible description (aria-label) so SR users get
  // the exact time without hovering. The inline header timestamp stays HH:MM.
  const preciseTime = fmtTimePrecise(m.createdAt, locale);
  const sentAtLabel = t("msg.sentAt", { time: preciseTime });
  // True while this row's recall is in the 5s undo window (the API delete hasn't
  // fired yet). The bubble collapses into a "you recalled a message · undo"
  // placeholder; undoing clears this and restores the row.
  const recalling = !!pendingRecalls?.has(m.id) && !m.deleted;
  // Bubble + alignment scheme (the standard chat-app mental model):
  //   - own messages: right-aligned, body in a mint-tinted bubble (bg-primary/15)
  //   - others: left-aligned, body in a raised-surface bubble (bg-card)
  // The avatar moves to the leading edge of the bubble in both cases
  // (i.e. on the right for self, on the left for others) via flex-row-reverse,
  // so it never sits awkwardly on the wrong side after alignment flips.
  // When a row pings the current user, the whole row gets a faint primary wash
  // + a left accent bar so it stands out at a glance even while scrolling.
  return (
    <>
      {showDay && <DayRule ms={m.createdAt} />}
      <div
        data-message-id={m.id}
        data-author={sanitizeDisplayString(m.authorName)}
        // Native title tooltip carries the precise send time; aria-label gives
        // SR users the same info (the inline HH:MM + author are already in the
        // row's text content, so the label focuses on the time precision).
        title={sentAtLabel}
        aria-label={sentAtLabel}
        // group/msg + relative anchor the floating action toolbar (MessageActions),
        // which fades in on hover/focus (desktop) or `pressed` (touch tap).
        onClick={() => {
          if (!canHover) setPressed((v) => !v);
        }}
        className={cn(
          "group/msg relative flex gap-x-2.5 rounded-md px-4 animate-slide-in transition-colors sm:px-6",
          grouped ? "pt-0.5 pb-1.5" : "py-1.5",
          self && "flex-row-reverse",
          pinged && "border-l-2 border-l-primary/40 bg-primary/5",
          // Cross-channel mention deep-link: a transient amber wash (~1.2s) when
          // the user jumps here from a toast. Reuses the pinged palette.
          highlighted && "bg-human/5",
        )}
      >
        <div className={cn("flex justify-center pt-1", self && "flex-row-reverse")}>
          {/* First-letter avatar tinted by name. On grouped rows it's invisible
              (opacity-0) but kept for column alignment — the header above already
              names the author, so a repeat would be noise. */}
          <Avatar name={m.authorName} className={cn("h-6 w-6 text-[10px]", grouped && "opacity-0")} />
        </div>
        <div className={cn("relative min-w-0 flex-1", self && "flex flex-col items-end")}>
          {/* Header (author + HH:MM) only on the FIRST row of a run. Per-message
              actions (reply/edit/recall/react) no longer live here - they moved to
              the floating MessageActions toolbar that fades in on hover/tap. */}
          {!grouped && (
            <div
              className={cn(
                "flex flex-wrap items-baseline gap-x-2.5",
                self && "flex-row-reverse",
              )}
            >
              <span className="font-mono text-[13px] font-medium text-foreground">
                {sanitizeDisplayString(m.authorName)}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground/90">{fmtTime(m.createdAt, locale)}</span>
              {m.editedAt && (
                <span className="font-mono text-[10px] lowercase text-muted-foreground/50">({t("msg.edited")})</span>
              )}
            </div>
          )}
          {/* Floating action toolbar: react / reply / edit (own) / recall (own).
              Fades in on hover/focus (desktop) or `pressed` (touch). Gated on
              !recalling && !m.deleted && !editing so it never competes with the
              undo placeholder, the recalled marker, or the inline editor. */}
          {!recalling && !m.deleted && !editing && (
            <MessageActions
              m={m}
              self={self}
              pressed={pressed}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
              onReact={onReact}
              startEdit={startEdit}
            />
          )}
          <div
            className={cn(
              "max-w-[85%] sm:max-w-[70%] md:max-w-[min(100%,60ch)] lg:max-w-[min(100%,72ch)] whitespace-pre-wrap break-words rounded-lg px-3 py-1.5 leading-snug",
              self ? "bg-primary/15 text-foreground" : "bg-card text-foreground",
              grouped ? "mt-0" : "mt-0.5",
              m.status === "sending" && "opacity-60",
              m.status === "failed" && "border border-destructive/50 bg-destructive/10",
              // Editing: a subtle ring distinguishes the inline editor bubble from
              // a normal read bubble, so the active-edit state reads clearly.
              editing && "ring-1 ring-ring/40",
            )}
          >
            {m.replyToId && (
              // Reply quote: author-tinted left bar (same hue as the author's
              // avatar) for visual association, and the whole quote is a button
              // that jumps to + highlights the original (reusing the deep-link
              // scroll/around machinery). Falls back to a non-interactive div
              // when no onJumpTo is wired (read-only / a11y renders).
              <QuoteBar
                replyTo={replyTo}
                replyToId={m.replyToId}
                onJumpTo={onJumpTo}
                recalledLabel={t("msg.recalled")}
                notFoundLabel={t("msg.replyNotFound")}
                jumpLabel={t("msg.jumpToOriginal")}
              />
            )}
            {recalling ? (
              // Undo window: the row hasn't been deleted server-side yet. Show a
              // muted placeholder + an inline "undo" action (Gmail/Slack style)
              // instead of vanishing instantly. A subtle fade/slide makes the
              // collapse read as deliberate, not a flicker.
              <div className="animate-in fade-in slide-in-from-bottom-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="italic">{t("msg.recalling")}</span>
                {onUndoRecall && (
                  <button
                    type="button"
                    data-testid={`undo-recall-${m.id}`}
                    onClick={() => onUndoRecall(m.id)}
                    className="rounded px-1 py-0.5 font-medium text-primary underline-offset-2 transition-colors hover:bg-primary/10 hover:underline"
                  >
                    {t("msg.undo")}
                  </button>
                )}
              </div>
            ) : m.deleted ? (
              <span className="italic text-muted-foreground">{t("msg.recalled")}</span>
            ) : editing ? (
              <div className="animate-in fade-in slide-in-from-bottom-1 duration-fast space-y-1.5">
                <textarea
                  ref={editRef}
                  value={draft}
                  disabled={editSaving}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setEditError(null);
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = Math.min(el.scrollHeight, 200) + "px";
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void saveEdit();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      cancelEdit();
                    }
                  }}
                  aria-label={t("msg.edit")}
                  className="block w-full resize-none rounded-md border border-border bg-background px-2 py-1 text-sm leading-snug focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-h-[200px]"
                  rows={1}
                />
                <div className="flex items-center gap-2">
                  <Button type="button" size="sm" onClick={() => void saveEdit()} disabled={editSaving}>
                    {editSaving ? t("msg.editSaving") : t("msg.editSave")}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={cancelEdit} disabled={editSaving}>
                    {t("msg.editCancel")}
                  </Button>
                  {/* Keyboard hint + inline error share the trailing space. */}
                  {!editError && (
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">
                      {t("msg.editHint")}
                    </span>
                  )}
                  {editError && (
                    <span role="alert" className="ml-auto font-mono text-[10px] text-destructive">
                      {editError}
                    </span>
                  )}
                </div>
              </div>
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
          {/* Reaction chips: clickable toggles (re-reacting with the same emoji
              toggles it off server-side). Each chip zooms in on first appearance
              and lifts on hover. Adding a NEW reaction is via the toolbar picker. */}
          {!m.deleted && !recalling && (m.reactions && m.reactions.length > 0) && (
            <div className={cn("mt-1 flex flex-wrap items-center gap-1", self && "justify-end")}>
              {m.reactions.map((r) => {
                const reacted = (r.count ?? 0) > 0;
                return (
                  <button
                    key={r.emoji}
                    type="button"
                    data-testid={`reaction-${m.id}-${r.emoji}`}
                    onClick={onReact ? () => onReact(m.id, r.emoji) : undefined}
                    disabled={!onReact}
                    aria-label={`${r.emoji} ${r.count}`}
                    className={cn(
                      "inline-flex animate-in zoom-in-75 duration-fast items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] transition-transform hover:scale-110 disabled:cursor-default",
                      reacted
                        ? "bg-accent text-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {r.emoji}
                    <span className="tabular-nums text-muted-foreground">{r.count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export const MessageList = forwardRef<MessageListHandle, MessageListProps>(function MessageList(
  { messages, me, members, status, channel, loadingChannel, highlightMessageId, onHighlightConsumed, onLoadMore, loadingMore, onReply, onDelete, onUndoRecall, pendingRecalls, onEdit, onReact, onJumpTo, onNeedAround },
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
  // Whether the device supports hover. Computed once; passed to every row so the
  // action toolbar is revealed by hover (desktop) or tap (touch) accordingly.
  const [canHover, setCanHover] = useState(true);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia) {
      setCanHover(window.matchMedia("(hover: hover)").matches);
    }
  }, []);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- GROUP_GAP_MS is a stable numeric constant (300000), safe to omit
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

  // Cross-channel @mention deep-link: scroll to the target message and briefly
  // highlight it (bg wash, ~1.2s) so the user sees what called them over. The
  // target message may not be in the list yet (it lands when the channel's history
  // fetch resolves after switching), so the effect retries as items grow until
  // it finds the id; a consumed-ref guards against re-firing once it's landed.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const highlightConsumedRef = useRef(false);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror loadingChannel + onNeedAround into refs so the highlight effect can
  // read the latest values without joining the deps (which would re-subscribe).
  const loadingChannelRef = useRef(false);
  loadingChannelRef.current = !!loadingChannel;
  const onNeedAroundRef = useRef(onNeedAround);
  onNeedAroundRef.current = onNeedAround;
  // Tracks the highlight target we've already requested context for, so the
  // around fetch fires at most once per target (avoids hammering the server on
  // every items-growth re-run while the fetch is in flight).
  const aroundFetchedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!highlightMessageId) {
      // No active target — arm for the next one, but leave any in-flight wash
      // alone so it finishes its 1.2s naturally.
      highlightConsumedRef.current = false;
      aroundFetchedRef.current = null;
      return;
    }
    if (highlightConsumedRef.current) return;
    const idx = itemsRef.current.findIndex(
      (it) => it.kind === "msg" && it.m.id === highlightMessageId,
    );
    if (idx < 0) {
      // Target not in the loaded window. Once the channel's initial history has
      // settled (not still loading) and we haven't already requested context for
      // THIS target, fetch around it so the highlight can land. The effect
      // re-runs as items grow (the around fetch merges new messages in), at
      // which point idx >= 0 and the highlight proceeds below.
      if (
        !loadingChannelRef.current &&
        aroundFetchedRef.current !== highlightMessageId
      ) {
        aroundFetchedRef.current = highlightMessageId;
        onNeedAroundRef.current?.(highlightMessageId);
      }
      return;
    }
    highlightConsumedRef.current = true;
    virtualizer.scrollToIndex(idx, { align: "center", behavior: "smooth" });
    setHighlightedId(highlightMessageId);
    onHighlightConsumed?.();
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedId(null), 1200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightMessageId, items.length]);

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
        {/* 180ms cross-fade on channel switch (design §2.1): the key on the wrapper
            remounts this subtree, playing a gentle fade-in + translateY(4px→0)
            so switching channels reads as "换台", not a hard cut. */}
        <div
          key={channel}
          className="flex flex-1 animate-in fade-in slide-in-from-bottom-1 items-center justify-center p-6 sm:p-10"
          style={{ animationDuration: "180ms", animationTimingFunction: "cubic-bezier(0.16,1,0.3,1)" }}
        >
          {loadingChannel ? (
            // Network-slow / first-fetch: shimmer skeleton bubbles keep the
            // container height stable instead of flashing the empty state then
            // popping in history. aria-busy announces the load to SR users.
            <div aria-busy="true" aria-label={t("msg.loadingChannel", { channel: channel ?? "general" })} className="w-full max-w-md space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-end gap-2.5" style={{ alignItems: i % 2 ? "flex-end" : undefined, flexDirection: i % 2 ? "row-reverse" : undefined }}>
                  <div className="h-6 w-6 flex-none rounded-full bg-muted" />
                  <div className="space-y-1.5">
                    <div className="h-2.5 w-16 bg-gradient-to-r from-muted via-accent/40 to-muted bg-[length:200%_100%] animate-shimmer rounded" />
                    <div className="h-7 w-48 bg-gradient-to-r from-muted via-accent/40 to-muted bg-[length:200%_100%] animate-shimmer rounded-lg" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="max-w-xs text-center">
              <div className="font-display text-2xl font-semibold tracking-tight">{t("msg.empty.title", { channel: channel ?? "general" })}</div>
              <div className="mx-auto mt-3 h-px w-8 bg-agent/60" aria-hidden />
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {t("msg.empty.body")}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      // Channel switch = "换台": a keyed remount (key={channel} at the caller) plays a
      // 180ms cross-fade + translateY(4px→0) on this subtree. 180ms is the
      // switch sweet spot (faster than message entrance's 320ms — switching is an
      // active gesture and should feel snappy). topbar/composer/searchbar aren't
      // in this subtree, so they stay rock-steady during the swap.
      key={channel}
      className="flex min-h-0 flex-1 flex-col animate-in fade-in slide-in-from-bottom-1"
      style={{ animationDuration: "180ms", animationTimingFunction: "cubic-bezier(0.16,1,0.3,1)" }}
    >
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
        aria-label={t("msg.logLabel", { channel: channel ?? "general" })}
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
                    highlighted={item.m.id === highlightedId}
                    canHover={canHover}
                    onReply={onReply}
                    replyTo={item.replyTo}
                    onDelete={onDelete}
                    onUndoRecall={onUndoRecall}
                    pendingRecalls={pendingRecalls}
                    onEdit={onEdit}
                    onReact={onReact}
                    onJumpTo={onJumpTo}
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