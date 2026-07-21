import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  arrow,
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
} from "@floating-ui/react-dom";
import { ClickAwayListener } from "@floating-ui/react-dom-interactions";
import { Smile } from "lucide-react";
import * as React from "react";

/** Quick-pick emoji palette offered on each message. Kept small and fixed so
 * the picker is a snappy hover panel, not a scrollable catalogue. */
export const REACTION_EMOJIS: readonly string[] = [
  "👍", "❤️", "😂", "🎉", "🔥", "🚀", "💯", "✨",
] as const;

/** Optional callback signature — used by MessageRow to drive the react API call. */
export type OnReact = (messageId: string, emoji: string) => void;

/** Optional props used only in tests to verify the panel renders at all. */
export interface EmojiPickerProps {
  /** Stable message id used to call the react API. */
  messageId: string;
  /** Current aggregated reaction list (from the message). Drives the "you reacted" highlight. */
  reactions?: readonly { emoji: string; count: number }[];
  /** Optional aria label override. Default is translated from i18n. */
  ariaLabel?: string;
  onReact: OnReact;
}

/**
 * Lightweight emoji picker — replaces the `emoji-picker` package to avoid a
 * huge bundle for a tiny fixed palette. Renders a floating card of emoji
 * buttons anchored to a trigger (a small smiley icon on the message).
 *
 * - Opens on hover (after a short 150ms delay so it's not annoying when
 *   scrolling past messages) and stays open until the pointer leaves or an
 *   emoji is clicked (click closes).
 * - Uses floating-ui (not a third-party picker) so collision-aware positioning
 *   matches the rest of the UI (MentionPopup etc.).
 * - Accessible: the panel is a labelled <div role="toolbar">; each emoji is a
 *   focusable <button>.
 *
 * @example
 * <EmojiPicker messageId={m.id} reactions={m.reactions} onReact={onReact}>
 *   <button type="button">📎</button>
 * </EmojiPicker>
 */
export function EmojiPicker({
  messageId,
  reactions,
  ariaLabel: ariaLabelProp,
  onReact,
  children,
}: React.PropsWithChildren<EmojiPickerProps>) {
  const t = useT();
  const ariaLabel = ariaLabelProp ?? t("msg.reactPicker");
  const [open, setOpen] = React.useState(false);
  const [openPending, setOpenPending] = React.useState(false);
  const openTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Highlight emojis the current user already reacted with (we don't know who
  // clicked which, so we simply light up any reaction that exists on the msg).
  const reactionMap = React.useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of reactions ?? []) map[r.emoji] = r.count;
    return map;
  }, [reactions]);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "top-start",
    middleware: [
      offset(8),
      flip({ fallbackAxisSideDirection: "end" }),
      shift({ padding: 8 }),
      arrow({ element: arrowRef.current }),
    ],
    whileElementsMounted: autoUpdate,
  });

  const arrowRef = React.useRef<HTMLDivElement>(null);

  // Hover open after a short delay so it's not annoying on scroll; instant
  // close on leave. We use the trigger's mouseEnter/mouseLeave so the panel
  // is part of the same hover-able region (we also attach mouseEnter/Leave to
  // the floating element itself).
  const scheduleOpen = React.useCallback(() => {
    if (open) return;
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    setOpenPending(true);
    openTimerRef.current = setTimeout(() => {
      setOpen(true);
      setOpenPending(false);
    }, 150);
  }, [open]);
  const cancelOpen = React.useCallback(() => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    setOpenPending(false);
  }, []);
  const close = React.useCallback(() => setOpen(false), []);

  const handlePick = React.useCallback(
    (emoji: string) => {
      onReact(messageId, emoji);
      close();
    },
    [onReact, messageId, close],
  );

  // Clean up the timer on unmount.
  React.useEffect(() => () => { if (openTimerRef.current) clearTimeout(openTimerRef.current); }, []);

  return (
    <ClickAwayListener onClickAway={close}>
      <>
        {/* Trigger — invisible by default; becomes visible on open-pending (a
            150ms pre-light) so the hover affordance feels immediate. */}
        <div
          ref={refs.setReference}
          onMouseEnter={scheduleOpen}
          onMouseLeave={cancelOpen}
          className="group/msg relative"
        >
          <span
            role="button"
            tabIndex={0}
            aria-label={ariaLabel}
            aria-expanded={open}
            data-testid="react-trigger"
            // The smiley only appears on hover (and when open) so it never
            // competes with the message content.
            className="inline-flex items-center justify-center rounded-md px-0.5 opacity-0 transition-opacity group-hover/msg:opacity-100"
          >
            {children ?? <Smile className="h-3.5 w-3.5 text-muted-foreground/70" />}
          </span>
          {/* Fallback: if the panel is open, keep the trigger visible so it can
              still be hovered as part of the open region. */}
          {openPending && (
            <span
              className="pointer-events-none absolute top-0 left-0 inline-flex items-center justify-center rounded-md px-0.5 opacity-100"
              aria-hidden
            >
              {children ?? <Smile className="h-3.5 w-3.5 text-muted-foreground/70" />}
            </span>
          )}
        </div>

        {open && (
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            // The floating element is also part of the hover region: hovering
            // the panel itself keeps it open.
            onMouseEnter={scheduleOpen}
            onMouseLeave={close}
            role="toolbar"
            aria-label={ariaLabel}
            data-testid="emoji-picker"
            className={cn(
              "z-50 flex w-auto overflow-hidden rounded-xl border border-border bg-card p-1.5 shadow-[var(--shadow-pop)]",
            )}
          >
            {REACTION_EMOJIS.map((emoji) => {
              const already = reactionMap[emoji] ?? 0;
              return (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`${emoji}（${t("msg.react")}）${already > 0 ? `（${already}）` : ""}`}
                  data-testid={`react-emoji-${emoji}`}
                  className={cn(
                    "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-lg transition-colors",
                    already > 0
                      ? "bg-accent font-bold"
                      : "hover:bg-accent active:bg-accent/80",
                  )}
                  onClick={() => handlePick(emoji)}
                >
                  {emoji}
                </button>
              );
            })}
            {/* Floating-ui arrow for depth cue; sits on the panel's border side
                facing the trigger. */}
            <div
              ref={arrowRef}
              className="z-[-1] h-2 w-2 rotate-45 bg-card transition-transform duration-200 ease-out"
              style={{
                transformOrigin: "0 0",
                ...(context.placement?.startsWith("top")
                  ? { transform: "translateY(8px)", borderTop: "1px solid var(--border)" }
                  : { transform: "translateY(-8px)", borderBottom: "1px solid var(--border)" }),
              }}
            />
          </div>
        )}
      </>
    </ClickAwayListener>
  );
}
