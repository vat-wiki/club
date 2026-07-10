import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AlertTriangle, Paperclip, Send } from "lucide-react";
import type { Participant, Message } from "@club/shared";
import { MAX_IMAGES_PER_MESSAGE } from "@club/shared";
import type { ClubConn } from "@club/sdk";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { MentionPopup } from "@/components/mention-popup";
import { MediaPreviewChip, type AttachmentDraft } from "@/components/media-preview-chip";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  applyMention,
  detectMention,
  filterMembers,
  MENTION_MAX_VISIBLE,
  type MentionQuery,
} from "@/lib/mention";
import {
  extractMediaFiles,
  validateMediaFile,
  type RejectReason,
} from "@/lib/upload";
import { api } from "@/lib/api";

export function Composer({
  onSend,
  disabled,
  members,
  selfId,
  conn,
  replyTo,
  onReplyClear,
}: {
  onSend: (content: string, attachmentIds: readonly string[], replyToId?: string) => Promise<void>;
  disabled?: boolean;
  /** Roster, used to source @-mention candidates. */
  members?: readonly Participant[];
  /** Current participant id; excluded from mention candidates. */
  selfId?: string;
  /** Active connection — needed to authorize multipart uploads (POST /files).
   *  Optional so tests/preview can mount the composer without a server. */
  conn?: ClubConn | null;
  /** Message being replied to (composer shows a quote preview); null normally. */
  replyTo?: Message | null;
  /** Clear the reply target (cancel reply mode). */
  onReplyClear?: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  // last failed draft — restored into the textarea on failure so the user can
  // edit/redo and resend, instead of the message vanishing silently.
  const [error, setError] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // ── Image attachment drafts ────────────────────────────────────────
  // Drafts live here until the message is sent; the server only ever sees the
  // `id` of a finished upload. We keep objectUrls in a ref so we can revoke
  // every one on unmount (cleanup), not just on send/remove.
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  // Transient inline validation message (e.g. "image can't exceed 10MB"). Set
  // when a picked/pasted/dropped file is rejected; cleared on the next change.
  const [attachError, setAttachError] = useState<string | null>(null);
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // ── Image draft lifecycle ──────────────────────────────────────────
  // revokeObjectURL on unmount for every URL we ever created, so a reload or
  // sign-out mid-upload doesn't leak blob memory.
  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => {
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, []);

  // Upload one file to POST /files, updating the matching draft's status /
  // progress as it goes. The draft is identified by its stable `key`, so an
  // upload started for an attachment that was later removed just no-ops. No
  // upload happens without a connection (the composer is disabled then anyway,
  // but guard defensively).
  const uploadDraft = useCallback(
    (key: string, file: File) => {
      if (!conn) return;
      api.uploadFile(conn, file, {
        // Videos can be large (up to 50MB); give them a generous upload window
        // so a slow connection isn't cut off at the image default (30s).
        timeoutMs: file.type.startsWith("video/") ? 180_000 : 30_000,
        onProgress: (loaded, total) => {
          const progress = total > 0 ? loaded / total : 0;
          setAttachments((prev) => prev.map((d) => (d.key === key ? { ...d, progress } : d)));
        },
      })
        .then((res) => {
          setAttachments((prev) =>
            prev.map((d) =>
              d.key === key ? { ...d, status: "done", progress: 1, remote: { id: res.id } } : d,
            ),
          );
        })
        .catch(() => {
          setAttachments((prev) =>
            prev.map((d) => (d.key === key ? { ...d, status: "error" } : d)),
          );
        });
    },
    [conn],
  );

  // Add a batch of candidate image files (from picker / paste / drop). Each is
  // validated against the shared whitelist + size cap before being accepted;
  // the first rejection surfaces as an inline message with the specific number.
  // We never silently drop a file — a wrong-format/oversized file is announced.
  const addFiles = useCallback(
    (files: readonly File[]) => {
      const media = extractMediaFiles(files as Iterable<File>);
      if (media.length === 0) return;

      setAttachError(null);
      setAttachments((prev) => {
        const remaining = MAX_IMAGES_PER_MESSAGE - prev.length;
        if (remaining <= 0) {
          setAttachError(t("image.tooMany", { max: MAX_IMAGES_PER_MESSAGE }));
          return prev;
        }
        // Validate up-front so we don't mint blob URLs for rejects. Reject
        // stops the whole add only when NOTHING would be accepted; otherwise we
        // take the valid ones and surface the first reason for the dropped one.
        const accepted: AttachmentDraft[] = [];
        let firstReject: RejectReason | null = null;
        for (const file of media) {
          if (accepted.length >= remaining) {
            firstReject = firstReject ?? { key: "image.tooMany", vars: { max: MAX_IMAGES_PER_MESSAGE } };
            break;
          }
          const reason = validateMediaFile(file);
          if (reason) {
            firstReject = firstReject ?? reason;
            continue;
          }
          const objectUrl = URL.createObjectURL(file);
          objectUrlsRef.current.add(objectUrl);
          accepted.push({
            key: `${file.name}-${file.size}-${objectUrl}`,
            file,
            objectUrl,
            kind: file.type.startsWith("video/") ? "video" : "image",
            status: "uploading",
            progress: 0,
          });
        }
        if (firstReject) {
          setAttachError(t(firstReject.key, firstReject.vars));
        }
        // Kick off uploads after state commits (queued via microtask so we read
        // the freshly minted keys without re-deriving them here).
        if (accepted.length > 0) {
          queueMicrotask(() => {
            for (const d of accepted) uploadDraft(d.key, d.file);
          });
        }
        return [...prev, ...accepted];
      });
    },
    [t, uploadDraft],
  );

  const removeAttachment = useCallback((key: string) => {
    setAttachments((prev) => {
      const target = prev.find((d) => d.key === key);
      if (target) {
        URL.revokeObjectURL(target.objectUrl);
        objectUrlsRef.current.delete(target.objectUrl);
      }
      return prev.filter((d) => d.key !== key);
    });
  }, []);

  const retryAttachment = useCallback(
    (key: string) => {
      setAttachments((prev) =>
        prev.map((d) => (d.key === key ? { ...d, status: "uploading", progress: 0 } : d)),
      );
      const target = attachments.find((d) => d.key === key);
      if (target) uploadDraft(key, target.file);
    },
    [attachments, uploadDraft],
  );

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

  // A sendable payload requires EITHER trimmed text OR at least one finished
  // image (plan §1: text is optional so a bare screenshot sends). Any draft
  // still uploading blocks send (and the user is told why via the hint).
  const hasUploading = attachments.some((d) => d.status === "uploading");
  const doneIds = attachments.filter((d) => d.status === "done" && d.remote).map((d) => d.remote!.id);
  const canSend = (value.trim().length > 0 || doneIds.length > 0) && !hasUploading;

  // ── Typing indicator ───────────────────────────────────────────────
  // Debounce "I'm typing" reports while composing, and auto-clear a short while
  // after the user stops. Sending a message also clears it (in submit). Fire-
  // and-forget — typing is best-effort presence, not a critical path.
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportTyping = useCallback(() => {
    if (!conn) return;
    void api.thinking(conn).catch(() => {});
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      void api.idle(conn).catch(() => {});
      typingTimer.current = null;
    }, 2500);
  }, [conn]);
  useEffect(() => () => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
  }, []);

  const submit = async () => {
    const content = value.trim();
    const ids = [...doneIds];
    if ((!content && ids.length === 0) || sending || hasUploading) return;
    setSending(true);
    setError(false);
    setValue("");
    closeMention();
    requestAnimationFrame(autosize);
    try {
      const replyId = replyTo?.id;
      if (replyId) await onSend(content, ids, replyId);
      else await onSend(content, ids);
      onReplyClear?.();
      // Send succeeded: the attachments now belong to the message, drop them
      // from the draft list and free their blob URLs.
      for (const d of attachments) {
        URL.revokeObjectURL(d.objectUrl);
        objectUrlsRef.current.delete(d.objectUrl);
      }
      setAttachments([]);
      // First successful send dismisses the onboarding hint for good (P2-2).
      markSent();
      // Message landed — stop the typing indicator.
      if (typingTimer.current) clearTimeout(typingTimer.current);
      if (conn) void api.idle(conn).catch(() => {});
    } catch {
      // Send failed: keep the text draft AND the image drafts so the user can
      // edit/redo without losing the (already-uploaded) images. Surface a
      // visible inline error.
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

  // The "Enter to send · shift+enter for newline" hint is useful for first-time
  // users but becomes permanent visual noise once they know the shortcut. We
  // persist a "has sent" flag to sessionStorage (per-device, survives reload but
  // not a fresh profile) and fade the hint out after the first successful send.
  // It still reappears while focused + empty (the moment a newcomer is most
  // likely to need a reminder), and the mention hint always shows when the
  // popup is open (that's contextual guidance, not onboarding).
  const [hasSent, setHasSent] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem("club_has_sent") === "1") setHasSent(true);
    } catch {
      /* sessionStorage may be unavailable */
    }
  }, []);
  const markSent = useCallback(() => {
    setHasSent(true);
    try {
      sessionStorage.setItem("club_has_sent", "1");
    } catch {
      /* ignore */
    }
  }, []);
  // Show the static hint when: the mention popup is open (contextual), OR the
  // user hasn't sent yet, OR the field is focused and empty (reminder moment).
  const showStaticHint = popupOpen || !hasSent || (focused && value.trim().length === 0);
  const visibleCount = Math.min(candidates.length, MENTION_MAX_VISIBLE);
  const safeActiveIndex = visibleCount === 0 ? 0 : activeIndex % visibleCount;
  const activeOptionId = popupOpen && candidates.length > 0 ? `mention-option-${safeActiveIndex}` : undefined;

  return (
    <form
      // Surface & chrome. The `after:` baseline is a brand "breath" line: at
      // rest a barely-there mint at opacity 0.08 (a hint of the input edge,
      // not noise), brightening to opacity 0.6 on focus-within, eased via
      // transition-opacity. The whole form lifts -1px on focus with a soft
      // up-shadow (P2-1) — read as the input bar "waking up".
      // Reduced-motion: the global `* { transition-duration: 0.001ms }` in
      // index.css only collapses the *easing*, not the end-state, so the -1px
      // lift and the shadow would still apply under prefers-reduced-motion.
      // We guard them explicitly with `motion-reduce:!transform-none` +
      // `motion-reduce:!shadow-none` (the `!` is required: same-specificity
      // variants would otherwise let focus-within win). (The after-opacity
      // state switch is a
      // state signal, not motion, so it intentionally stays.)
      className="relative flex-none border-t border-border bg-chrome px-4 py-3 transition-transform sm:focus-within:-translate-y-px sm:focus-within:shadow-[0_-4px_16px_-8px_hsl(0_0%_0%/0.5)] motion-reduce:!transform-none motion-reduce:!shadow-none after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-agent after:to-transparent after:opacity-[0.08] after:transition-opacity after:duration-slow focus-within:after:opacity-60 sm:px-5"
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
      <div
        className="relative flex items-end gap-2.5 rounded-md border border-[hsl(240_5%_26%)] bg-card p-0.5 transition-colors duration-150 focus-within:border-agent/50"
        // Drop target for image files. We MUST preventDefault on dragover and
        // drop: otherwise the browser treats a dropped image as a URL the user
        // wants to navigate to — replacing the whole page and booting them out
        // of the room (plan §5 / 王体验取证). Only intercept when the drag
        // actually carries files, so plain text drags keep working.
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
          e.preventDefault();
          addFiles(Array.from(e.dataTransfer.files));
        }}
      >
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
        {/* Attach button — the third leg of the input bar (attach | textarea |
            send), left/right symmetric with Send. Ghost + muted grey on
            purpose: mint is reserved as Send's exclusive "ready" signal, so
            attach stays a neutral tool. Co-heighted with the textarea (the
            same min-h strategy as Send) so all three legs share one bar.
            aria-label is required (icon-only button). A count badge "N/MAX"
            surfaces how close the user is to the per-message image cap; at the
            cap the button is disabled and the badge turns destructive (P2-3). */}
        <Button
          type="button"
          variant="ghost"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || attachments.length >= MAX_IMAGES_PER_MESSAGE}
          aria-label={
            attachments.length > 0
              ? t("composer.attach.ariaCount", { count: attachments.length, max: MAX_IMAGES_PER_MESSAGE })
              : t("composer.attach.aria")
          }
          title={
            attachments.length >= MAX_IMAGES_PER_MESSAGE
              ? t("image.tooMany", { max: MAX_IMAGES_PER_MESSAGE })
              : undefined
          }
          data-testid="composer-attach-button"
          className="relative min-h-[48px] shrink-0 px-2 text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:min-h-[56px]"
        >
          <Paperclip className="h-4 w-4" aria-hidden />
          {attachments.length > 0 && (
            // Visually-hidden? No — a sighted user benefits from seeing N/MAX at
            // a glance. aria-hidden because the button's aria-label already
            // spells out the count for SRs (no double-announce).
            <span
              aria-hidden
              className={cn(
                "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[9px] leading-none",
                attachments.length >= MAX_IMAGES_PER_MESSAGE
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-accent text-accent-foreground",
              )}
            >
              {attachments.length}/{MAX_IMAGES_PER_MESSAGE}
            </span>
          )}
        </Button>
        {/* Hidden file picker. `capture` hints mobile browsers to offer the
            camera, but multiple + the accept whitelist still govern desktop.
            Controlled indirectly (value reset after change so the same file can
            be re-picked). */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm"
          multiple
          capture
          hidden
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) addFiles(Array.from(files));
            // Reset so picking the same file again fires onChange.
            e.target.value = "";
          }}
        />
        {/* Visually-hidden label gives the textarea an accessible name; the
            placeholder alone is not a substitute (WCAG 1.3.1 / 3.3.2). */}
        <label htmlFor="composer-input" className="sr-only">
          {t("composer.label")}
        </label>
        {/* Textarea + chip row share a single flex column so the chips sit
            directly under the text (still inside the mint-bordered bar) while
            attach/send stay pinned left/right as bar legs. */}
        {replyTo && (
          <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5 text-xs">
            <span className="min-w-0 truncate text-muted-foreground">
              {t("msg.replyingTo", { name: replyTo.authorName })}
              <span className="ml-1 text-foreground/80">
                {replyTo.content.slice(0, 80) || "…"}
              </span>
            </span>
            <button
              type="button"
              onClick={onReplyClear}
              aria-label={t("msg.reply")}
              className="ml-auto flex-none rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
        <Textarea
          ref={ref}
          id="composer-input"
          value={value}
          rows={1}
          disabled={disabled}
          data-testid="composer-input"
          placeholder={t("composer.placeholder")}
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
            setAttachError(null);
            if (next.trim()) reportTyping();
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
          // Image paste: if the clipboard carries an image file, intercept and
          // route it to the preview (preventDefault) instead of letting the
          // browser paste a raw file reference. Plain-text paste is left to the
          // default behavior (no preventDefault).
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.items)
              .filter(
                (it) =>
                  it.kind === "file" &&
                  (it.type.startsWith("image/") || it.type.startsWith("video/")),
              )
              .map((it) => it.getAsFile())
              .filter((f): f is File => !!f);
            if (files.length > 0) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {/* Image chip row. Appears only when there are drafts, expanding the
            bar downward (the textarea keeps its own height). flex-wrap so >3
            chips wrap to a second line; gap-2 + px-1 pt-1 keep them aligned to
            the textarea's text column. */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1 pt-1" data-testid="composer-attachments">
            {attachments.map((d, i) => {
              const isVideo = d.kind === "video";
              return (
                <MediaPreviewChip
                  key={d.key}
                  draft={d}
                  labelDone={t(isVideo ? "video.chip.done" : "image.chip.done", { index: i + 1 })}
                  labelUploading={(p) =>
                    t(isVideo ? "video.chip.uploading" : "image.chip.uploading", {
                      index: i + 1,
                      percent: p,
                    })
                  }
                  labelError={t(isVideo ? "video.chip.error" : "image.chip.error", { index: i + 1 })}
                  removeLabel={t(isVideo ? "video.remove.aria" : "image.remove.aria", { index: i + 1 })}
                  retryLabel={t(isVideo ? "video.retry.aria" : "image.retry.aria", { index: i + 1 })}
                  onRemove={() => removeAttachment(d.key)}
                  onRetry={() => retryAttachment(d.key)}
                />
              );
            })}
          </div>
        )}
        </div>
        <Button
          type="submit"
          size="default"
          disabled={disabled || sending || !canSend}
          data-testid="composer-send-button"
          // Match the textarea's min-height (48px mobile / 56px sm up) so the
          // button and the textarea are co-heighted in the common single-line
          // case. The container is `items-end`, so when both share the same
          // height they're not only bottom-aligned but also vertically
          // centered — fixing the "send button sits too low / off-center in
          // the focused input bar" issue (the 44px fixed button left a 12px
          // gap on top, 3px on bottom → button center 6px below textarea
          // center). When the textarea grows past min-height (multi-line),
          // `items-end` still correctly anchors the button to the bottom.
          // P2-2: disabled collapses to a neutral grey (bg-muted + muted-
          // foreground, opacity 100 so the text stays legible) — the mint is
          // reserved as the "ready to send" signal, lit only when there's
          // something to transmit. This stops the empty-state mint button from
          // out-shouting the input. base Button applies disabled:opacity-50;
          // we override to 100 because opacity-50 on muted text would push it
          // below AA. disabled text/bg still clear AA here (≈6.5:1), and the
          // disabled control is itself WCAG-eligible but we keep it legible.
          className="min-h-[48px] gap-1.5 enabled:bg-primary enabled:text-primary-foreground disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 sm:min-h-[56px]"
        >
          <Send className="h-4 w-4" aria-hidden />
          {t("composer.send")}
        </Button>
      </div>
      {error ? (
        <p
          role="alert"
          className="mt-1.5 flex items-center gap-1.5 font-mono text-[11px] text-destructive"
        >
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          {t("composer.sendFailed")}
        </p>
      ) : attachError ? (
        // A picked/pasted/dropped file was rejected (wrong type / too large /
        // too many). role=alert so SRs announce it. Cleared on the next change.
        <p
          role="alert"
          className="mt-1.5 flex items-center gap-1.5 font-mono text-[11px] text-destructive"
        >
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          {attachError}
        </p>
      ) : hasUploading ? (
        // Send is intentionally disabled while an image is mid-upload; tell the
        // user why instead of leaving the button grey without explanation.
        <p
          role="status"
          aria-live="polite"
          className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/90"
        >
          {t("composer.uploading")}
        </p>
      ) : (
        <p
          id="composer-hint"
          // P2-2: the static shortcut hint fades out (opacity + height collapse)
          // once the user has sent a message and isn't in a "reminder" moment
          // (focused + empty), so it stops competing for attention. The mention
          // hint (popupOpen) always shows since it's contextual, not onboarding.
          // When hidden we keep a min-h-[0.5rem] slot so the layout doesn't jump
          // when it transitions in/out. transition-opacity respects reduced
          // motion via the global wildcard.
          className={cn(
            "mt-1.5 overflow-hidden font-mono text-[10px] uppercase tracking-wider text-muted-foreground/90 transition-opacity duration-slow",
            showStaticHint ? "max-h-6 opacity-100" : "max-h-0 opacity-0",
          )}
          aria-hidden={showStaticHint ? undefined : true}
        >
          {t("composer.hint")}
          {popupOpen ? <span className="hidden sm:inline">{t("composer.hintMention")}</span> : null}
        </p>
      )}
    </form>
  );
}
