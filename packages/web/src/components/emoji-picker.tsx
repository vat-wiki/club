import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  arrow,
  autoUpdate,
  flip,
  offset,
  shift,
} from "@floating-ui/react-dom";
import { useDismiss, useFloating, useInteractions } from "@floating-ui/react-dom-interactions";
import { Smile } from "lucide-react";
import * as React from "react";

/** Quick-pick emoji palette offered on each message. Kept small and fixed so
 * the picker is a snappy hover panel, not a scrollable catalogue. */
export const REACTION_EMOJIS: readonly string[] = [
  "👍", "❤️", "😂", "🎉", "🔥", "🚀", "💯", "✨",
] as const;

/** Optional callback signature - used by MessageRow to drive the react API call. */
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
 * Emoji reaction trigger + floating palette. The trigger is a click-toggle
 * button (icon); the palette is a floating card of emoji anchored to it via
 * floating-ui (collision-aware, matches the rest of the UI).
 *
 * Visibility of the trigger is owned by the parent message-actions toolbar,
 * which fades the whole toolbar in on row hover/focus - so the trigger here is
 * always opaque. (Previously the trigger used a self-referential `group/msg`
 * hover that lit up only when hovering the invisible trigger itself, making
 * reactions effectively undiscoverable; moving to click + parent-owned fade
 * fixes that.)
 *
 * Accessible: the panel is a labelled <div role="toolbar">; each emoji is a
 * focusable <button>. The trigger is a real <button> with aria-haspopup.
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

  // Highlight emojis the current user already reacted with (we don't know who
  // clicked which, so we simply light up any reaction that exists on the msg).
  const reactionMap = React.useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of reactions ?? []) map[r.emoji] = r.count;
    return map;
  }, [reactions]);

  const arrowRef = React.useRef<HTMLDivElement>(null);

  // v2 floating-ui API: useFloating from react-dom-interactions provides
  // open/onOpenChange support, context for useDismiss, refs, and top-level
  // reference()/floating() setter functions.
  const { context, x, y, strategy, reference, floating } = useFloating({
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

  // Bridge floating-ui's generic setter functions to element-specific refs.
  const triggerRef = React.useCallback(
    (node: HTMLButtonElement | null) => reference(node as unknown as HTMLElement),
    [reference],
  );
  const panelRef = React.useCallback(
    (node: HTMLDivElement | null) => floating(node),
    [floating],
  );

  // Build floating styles from positioning values (v2 API doesn't provide
  // floatingStyles directly).
  const floatingStyles: React.CSSProperties = {
    position: strategy,
    top: y ?? 0,
    left: x ?? 0,
    transform: strategy === "fixed" ? `translate(-50%, -50%)` : undefined,
  };

  // Use the interactions API for click-away dismiss (replaces ClickAwayListener).
  const dismiss = useDismiss(context, { outsidePress: true });
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

  // Click to toggle (the parent toolbar owns the trigger's fade-in). Picking an
  // emoji or clicking outside closes the palette.
  const toggle = React.useCallback(() => setOpen((v) => !v), []);
  const close = React.useCallback(() => setOpen(false), []);

  const handlePick = React.useCallback(
    (emoji: string) => {
      onReact(messageId, emoji);
      close();
    },
    [onReact, messageId, close],
  );

  return (
    <>
      {/* Trigger - a real button, always opaque (the toolbar controls fade). */}
      <button
        type="button"
        ref={triggerRef}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="react-trigger"
        onClick={toggle}
        {...getReferenceProps()}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {children ?? <Smile className="h-4 w-4" />}
      </button>

      {open && (
        <div
          ref={panelRef}
          style={floatingStyles}
          role="toolbar"
          aria-label={ariaLabel}
          data-testid="emoji-picker"
          {...getFloatingProps()}
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
  );
}
