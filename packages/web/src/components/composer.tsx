import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AlertTriangle, Send } from "lucide-react";
import type { Participant } from "@club/shared";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { MentionPopup } from "@/components/mention-popup";
import {
  applyMention,
  detectMention,
  filterMembers,
  MENTION_MAX_VISIBLE,
  type MentionQuery,
} from "@/lib/mention";

export function Composer({
  onSend,
  disabled,
  members,
  selfId,
}: {
  onSend: (content: string) => Promise<void>;
  disabled?: boolean;
  /** Roster, used to source @-mention candidates. */
  members?: readonly Participant[];
  /** Current participant id; excluded from mention candidates. */
  selfId?: string;
}) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  // last failed draft — restored into the textarea on failure so the user can
  // edit/redo and resend, instead of the message vanishing silently.
  const [error, setError] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // ── @-mention state ────────────────────────────────────────────────
  // The active mention query (the `@...` token currently being typed at the
  // caret), or null when no mention is open. Recomputed on every change.
  const [mention, setMention] = useState<{
    query: MentionQuery;
    caret: number;
  } | null>(null);
  // Highlighted candidate index within the filtered list.
  const [activeIndex, setActiveIndex] = useState(0);
  // Pixel position (relative to the textarea's offset parent) of the caret, so
  // the popup can anchor to it. Updated alongside `mention`.
  const [anchor, setAnchor] = useState({ top: 0, left: 0 });

  const candidates = useMemo<Participant[]>(() => {
    if (!mention || !members) return [];
    return filterMembers(mention.query.query, members, selfId);
  }, [mention, members, selfId]);

  const closeMention = useCallback(() => {
    setMention(null);
    setActiveIndex(0);
  }, []);

  // When the user presses Escape to dismiss the popup, remember the value at
  // that moment. The popup stays dismissed while the user is just moving the
  // caret through the same text (arrows / clicks) — matching Slack, where Esc
  // is a firm "not now". As soon as the value changes (the user types or
  // deletes), onChange clears the dismissal so detection re-enables.
  const dismissedValue = useRef<string | null>(null);
  const dismissHere = useCallback(() => {
    dismissedValue.current = ref.current?.value ?? null;
    closeMention();
  }, [closeMention]);

  const autosize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // Cap auto-growth at 200px (matches the CSS max-h-[200px] on the element);
    // beyond that the textarea scrolls internally so a long draft doesn't
    // squeeze the message list out of view.
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);

  // Measure the caret's pixel position (relative to the textarea's offset
  // parent) by cloning the textarea's styles into a hidden mirror div and
  // inserting a caret marker at the selection point. This is the standard
  // technique for positioning an inline popup at a <textarea>/<input> caret.
  const measureCaret = useCallback((text: string, caret: number) => {
    const el = ref.current;
    if (!el) return { top: 0, left: 0 };
    const style = window.getComputedStyle(el);
    const mirror = document.createElement("div");
    // Copy layout-affecting styles so wrapped text matches the textarea.
    mirror.style.position = "absolute";
    mirror.style.visibility = "hidden";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordBreak = style.wordBreak;
    mirror.style.overflowWrap = style.overflowWrap;
    mirror.style.width = style.width;
    mirror.style.border = style.border;
    mirror.style.boxSizing = style.boxSizing;
    mirror.style.padding = style.padding;
    mirror.style.font = style.font;
    mirror.style.lineHeight = style.lineHeight;
    mirror.style.letterSpacing = style.letterSpacing;
    mirror.style.top = "0";
    mirror.style.left = "0";
    // Text before the caret, with a marker span we can measure; rest of the
    // text after to keep wrapping correct.
    const before = document.createTextNode(text.slice(0, caret));
    const marker = document.createElement("span");
    marker.textContent = "|";
    const after = document.createTextNode(text.slice(caret));
    mirror.appendChild(before);
    mirror.appendChild(marker);
    mirror.appendChild(after);
    el.offsetParent?.appendChild(mirror);
    const markerRect = marker.getBoundingClientRect();
    const parentRect = el.offsetParent?.getBoundingClientRect();
    const top = markerRect.top - (parentRect?.top ?? 0);
    const left = markerRect.left - (parentRect?.left ?? 0);
    mirror.remove();
    return { top, left };
  }, []);

  // Recompute the active mention after the value changes. We read the fresh
  // caret from the DOM (React hasn't reconciled the selection yet).
  const recomputeMention = useCallback(
    (text: string, caret: number) => {
      // Honor an Escape-dismissal: stay closed while the value is unchanged
      // (caret moves through the same text don't re-open). onChange clears the
      // dismissal as soon as the text actually changes.
      if (dismissedValue.current !== null && dismissedValue.current === text) return;
      dismissedValue.current = null;
      const q = detectMention(text, caret);
      if (!q) {
        closeMention();
        return;
      }
      setAnchor(measureCaret(text, caret));
      setMention((prev) => {
        // Reset the active index when the query string changes (new filter
        // results); keep it stable otherwise (e.g. caret moved within token).
        if (!prev || prev.query.query !== q.query) setActiveIndex(0);
        return { query: q, caret };
      });
    },
    [closeMention, measureCaret],
  );

  const submit = async () => {
    const content = value.trim();
    if (!content || sending) return;
    setSending(true);
    setError(false);
    setValue("");
    closeMention();
    requestAnimationFrame(autosize);
    try {
      await onSend(content);
    } catch {
      // Send failed: put the draft back so the user isn't left thinking it
      // went through, and surface a visible inline error.
      setError(true);
      setValue(content);
      requestAnimationFrame(() => {
        autosize();
        ref.current?.focus();
      });
    } finally {
      setSending(false);
    }
  };

  // Accept the candidate at `index` (or activeIndex): splice the `@query`
  // token into `@<name> ` at the caret, restore focus + caret.
  const acceptMention = useCallback(
    (member: Participant) => {
      if (!mention) return;
      const { text, caret } = applyMention(value, mention.query, member.name);
      setValue(text);
      closeMention();
      requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(caret, caret);
        autosize();
      });
    },
    [mention, value, closeMention, autosize],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Mention-open keyboard handling. These must run BEFORE the Enter-to-send
    // rule below, and must preventDefault so they don't also move the caret or
    // (for Enter/Tab) trigger send / newline insertion.
    if (mention && candidates.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % Math.min(candidates.length, MENTION_MAX_VISIBLE));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex(
          (i) =>
            (i - 1 + Math.min(candidates.length, MENTION_MAX_VISIBLE)) %
            Math.min(candidates.length, MENTION_MAX_VISIBLE),
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const candidate = candidates[activeIndex];
        if (candidate) acceptMention(candidate);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        dismissHere();
        return;
      }
    } else if (mention && e.key === "Escape") {
      // No candidates but popup open (showing the empty state) — Esc closes.
      e.preventDefault();
      dismissHere();
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
    // caret-position keys (Home/End/arrows) need mention recompute on keyup;
    // handled in onKeyUp below.
  };

  // After caret-moving keys (arrows when popup closed, Home/End, click), the
  // active token may have changed without a value change — re-detect.
  const onKeyUp = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (el.selectionStart !== el.selectionEnd) return; // ignore selections
    // ArrowDown/ArrowUp are handled in onKeyDown when popup is open; when the
    // popup is closed they move the caret and we should re-evaluate.
    recomputeMention(el.value, el.selectionStart);
  };

  // Close the popup if the textarea loses focus (e.g. user clicks elsewhere).
  // The popup itself prevents pointer-down from blurring, so click-to-select
  // still works.
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) closeMention();
  }, [focused, closeMention]);

  const popupOpen = !!mention;
  const visibleCount = Math.min(candidates.length, MENTION_MAX_VISIBLE);
  const safeActiveIndex = visibleCount === 0 ? 0 : activeIndex % visibleCount;
  const activeOptionId = popupOpen && candidates.length > 0 ? `mention-option-${safeActiveIndex}` : undefined;

  return (
    <form
      className="relative flex-none border-t border-border bg-chrome px-5 py-3 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-agent/60 after:to-transparent after:opacity-0 after:transition-opacity after:duration-slow focus-within:after:opacity-100"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {/*
        The flex row is itself the "input bar" container: one shared raised
        surface (bg-card, one step above the message-list bg) + a visible
        border (L26%, ~2.3:1 on the deep neutral — a real edge instead of the
        near-invisible default). textarea and send button read as two parts of
        a single bar, not two unrelated widgets. p-0.5 insets them so the mint
        button never kisses the container edge. Pure CSS — no extra DOM.

        Focus linkage (P1): on focus-within the container border switches from
        the neutral L26 grey to brand mint at 50% opacity (border-agent/50),
        concentrating the brand signal on a SINGLE container edge — Linear /
        Vercel style — instead of three scattered mint signals (inner textarea
        ring + neutral container edge + bottom gradient). The textarea's own
        ring is dropped (see below) so there's no "inner mint + outer grey"
        double-line. transition-colors respects prefers-reduced-motion via the
        global * wildcard in index.css. No box-shadow glow: the single mint
        edge is already a clear, AA-compliant focus indicator (≥3:1 on the
        adjacent chrome), so a glow would be over-design.
      */}
      <div className="relative flex items-end gap-2.5 rounded-md border border-[hsl(240_5%_26%)] bg-card p-0.5 transition-colors duration-150 focus-within:border-agent/50">
        {/* Mention popup: anchored relative to this flex row (the textarea's
            offset parent). Rendered above the caret line. */}
        {popupOpen && (
          <MentionPopup
            members={candidates}
            activeIndex={safeActiveIndex}
            query={mention.query.query}
            anchor={anchor}
            onSelect={acceptMention}
            onHover={(i) => setActiveIndex(i)}
          />
        )}
        {/* Visually-hidden label gives the textarea an accessible name; the
            placeholder alone is not a substitute (WCAG 1.3.1 / 3.3.2). */}
        <label htmlFor="composer-input" className="sr-only">
          Message #general
        </label>
        <Textarea
          ref={ref}
          id="composer-input"
          value={value}
          rows={1}
          disabled={disabled}
          placeholder="transmit to #general…"
          // The textarea dissolves into the input-bar container: transparent
          // background (inherits the container's bg-card) and no border of its
          // own, so the container edge is the single, clean input boundary
          // (P0-1/P0-4). Focus feedback is carried SOLELY by the container's
          // mint border (focus-within:border-agent/50, see the flex row above)
          // plus the form's bottom `after:` baseline — a single brand edge,
          // not an inner textarea ring + outer grey edge double-line (P1).
          // The native caret still marks the insertion point. Per WCAG 2.4.7
          // the container mint border is the visible focus indicator (≥3:1 on
          // adjacent chrome), so no per-field ring is needed.
          //
          // Height: ~48px on mobile (narrow viewport, don't eat message
          // space), 56px (~1.5 lines) from sm up — a chat-sized surface, not
          // a search-box sliver (P0-5). max-h + internal scroll cap long
          // drafts so the message list stays visible.
          className="min-h-[48px] resize-none border-0 bg-transparent px-3.5 py-3 focus-visible:ring-0 focus-visible:ring-offset-0 sm:min-h-[56px] max-h-[200px] overflow-y-auto"
          aria-describedby="composer-hint"
          aria-invalid={error}
          // Combobox semantics: the textarea acts as the input of a combobox
          // whose listbox is the mention popup. aria-activedescendant points
          // at the highlighted option so SRs announce it without moving focus.
          aria-expanded={popupOpen}
          aria-controls={popupOpen ? "mention-listbox" : undefined}
          aria-activedescendant={activeOptionId}
          aria-autocomplete="list"
          role="combobox"
          onChange={(e) => {
            const next = e.target.value;
            setValue(next);
            setError(false);
            // A value change is fresh user input — clear any Escape-dismissal
            // so the popup can re-open for the new text.
            dismissedValue.current = null;
            autosize();
            // Use rAF so the textarea's selection has updated to the new caret
            // before we measure.
            requestAnimationFrame(() => {
              const el = ref.current;
              if (!el) return;
              recomputeMention(next, el.selectionStart);
            });
          }}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        <Button
          type="submit"
          size="default"
          disabled={disabled || sending || !value.trim()}
          // Match the textarea's min-height (48px mobile / 56px sm up) so the
          // button and the textarea are co-heighted in the common single-line
          // case. The container is `items-end`, so when both share the same
          // height they're not only bottom-aligned but also vertically
          // centered — fixing the "send button sits too low / off-center in
          // the focused input bar" issue (the 44px fixed button left a 12px
          // gap on top, 3px on bottom → button center 6px below textarea
          // center). When the textarea grows past min-height (multi-line),
          // `items-end` still correctly anchors the button to the bottom.
          className="min-h-[48px] gap-1.5 sm:min-h-[56px]"
        >
          <Send className="h-4 w-4" aria-hidden />
          send
        </Button>
      </div>
      {error ? (
        <p
          role="alert"
          className="mt-1.5 flex items-center gap-1.5 font-mono text-[11px] text-destructive"
        >
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          couldn't send — check your connection and try again
        </p>
      ) : (
        <p
          id="composer-hint"
          className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/90"
        >
          enter to transmit · shift+enter for a new line
          {popupOpen ? " · ↑↓ to pick · enter to mention · esc to cancel" : ""}
        </p>
      )}
    </form>
  );
}
