import { useEffect, useRef } from "react";
import type { Participant } from "@club/shared";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { MENTION_MAX_VISIBLE } from "@/lib/mention";

/**
 * Floating @-mention autocomplete list.
 *
 * Rendered as an absolutely-positioned listbox anchored above (or below) the
 * composer textarea. ARIA combobox pattern: the textarea keeps DOM focus and
 * holds `aria-activedescendant` pointing at the active option's id, so screen
 * readers announce the highlighted candidate as the user arrows through it
 * without moving focus. Keyboard handling (ArrowUp/Down/Enter/Tab/Esc) lives in
 * the Composer; this component is presentational + click-to-select.
 */
export function MentionPopup({
  members,
  activeIndex,
  query,
  anchor,
  onSelect,
  onHover,
}: {
  members: readonly Participant[];
  /** Currently highlighted candidate (keyboard-tracked in the Composer). */
  activeIndex: number;
  /** The raw query token (without `@`); rendered as a muted hint. */
  query: string;
  /** Pixel coordinates (relative to the textarea's offset parent) to anchor at. */
  anchor: { top: number; left: number };
  onSelect: (member: Participant) => void;
  /** Called when the pointer enters an option, so the Composer can move the
   *  highlight to match (unifies mouse hover with keyboard navigation). */
  onHover?: (index: number) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const t = useT();
  const visible = members.slice(0, MENTION_MAX_VISIBLE);
  const hasOverflow = members.length > MENTION_MAX_VISIBLE;

  // Keep the active option scrolled into view when arrowing past the viewport
  // edge. The Composer controls activeIndex; we just mirror it to scroll.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Decide whether to drop the popup up or down: we anchor at `anchor.top`
  // which the Composer computes as the textarea caret's top; the popup renders
  // *above* that line by default (Slack-style) so it doesn't cover the line
  // being typed. The Composer passes coordinates in the textarea's offset
  // parent's coordinate space.
  return (
    <ul
      ref={listRef}
      role="listbox"
      id="mention-listbox"
      aria-label={t("mention.aria")}
      data-testid="mention-popup"
      className="absolute z-50 max-h-[min(240px,60vh)] w-64 overflow-auto rounded-lg border border-border bg-popover p-1 shadow-lg shadow-black/40 scrollbar-thin"
      style={{
        left: anchor.left,
        // Place the popup's bottom edge 6px above the anchor line.
        bottom: `calc(100% - ${anchor.top}px + 6px)`,
      }}
      // Prevent pointer-down on the popup from blurring the textarea (which
      // would close the mention before the click registers as a select).
      onPointerDown={(e) => e.preventDefault()}
    >
      {visible.length === 0 ? (
        <li
          role="presentation"
          className="px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground"
        >
          {t("mention.noMatch", { query })}
        </li>
      ) : (
        visible.map((m, i) => (
          <li
            key={m.id}
            id={`mention-option-${i}`}
            role="option"
            aria-selected={i === activeIndex}
            data-testid="mention-option"
            data-active={i === activeIndex ? "" : undefined}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors",
              i === activeIndex
                ? "bg-accent text-accent-foreground"
                : "text-popover-foreground",
            )}
            // Mouse hover mirrors the keyboard highlight so click + hover feel
            // unified. Hover doesn't move focus (the textarea keeps it so the
            // user can keep typing / arrowing).
            onMouseEnter={() => onHover?.(i)}
            onClick={() => onSelect(m)}
          >
            <span
              aria-hidden
              // Agent dot pulses (same as roster/message row) so "@person vs
              // @agent" is visually distinguishable in the option list, not
              // only by the trailing kind label.
              className={cn(
                "h-2 w-2 flex-none rounded-full",
                m.kind === "agent" ? "bg-agent animate-agent-pulse" : "bg-human",
              )}
            />
            <span className="truncate">{m.name}</span>
            <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {m.kind === "agent" ? t("mention.kindAgent") : t("mention.kindHuman")}
            </span>
          </li>
        ))
      )}
      {hasOverflow && (
        <li
          aria-hidden
          className="px-2.5 py-1 text-center font-mono text-[10px] text-muted-foreground/80"
        >
          {t("mention.more", { count: members.length - MENTION_MAX_VISIBLE })}
        </li>
      )}
    </ul>
  );
}
