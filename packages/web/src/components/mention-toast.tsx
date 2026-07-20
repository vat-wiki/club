import { Avatar } from "@/components/avatar";
import type { MentionToast } from "@/hooks/use-rooms";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// A single cross-room @mention toast. Slides in from the bottom, auto-dismisses
// after ~6s, and pauses on hover/focus so keyboard + pointer users both get a
// fair chance to click the deep-link. Clicking jumps to the source room + message.
function Toast({
  toast,
  onActivate,
  onDismiss,
}: {
  toast: MentionToast;
  onActivate: (toast: MentionToast) => void;
  onDismiss: (id: string) => void;
}) {
  const t = useT();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [leaving, setLeaving] = useState(false);

  // Auto-dismiss after 6s. Paused while hovered or focused (the timer is cleared
  // on enter/focus and restarted on leave/blur). On fire we play the out-animation
  // before removing, so the exit reads as a slide-down rather than a vanish.
  const arm = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setLeaving(true);
      window.setTimeout(() => onDismiss(toast.id), 200);
    }, 6000);
  };
  const disarm = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => {
    arm();
    return disarm;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ariaLabel = t("toast.mention.aria", {
    author: toast.authorName,
    room: toast.room,
  });

  return (
    <button
      type="button"
      onClick={() => onActivate(toast)}
      aria-label={ariaLabel}
      data-testid={`mention-toast-${toast.id}`}
      onMouseEnter={disarm}
      onMouseLeave={arm}
      onFocus={disarm}
      onBlur={arm}
      className={cn(
        // amber left bar (mirrors the banner手法) + raised card surface + the
        // deep-surface pop shadow. pointer-events-auto so only the toasts catch
        // clicks, not the transparent container.
        "pointer-events-auto flex w-[min(92vw,22rem)] items-center gap-2.5 rounded-lg border-l-2 border-l-human bg-card px-3 py-2.5 text-left shadow-[var(--shadow-pop)] outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
        leaving
          ? "animate-out fade-out-0 slide-out-to-bottom-2 duration-200"
          : "animate-in slide-in-from-bottom-3 fade-in-0 duration-slow",
      )}
    >
      <Avatar name={toast.authorName} className="h-6 w-6 flex-none text-[10px]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-foreground">
          <span className="font-medium">{toast.authorName}</span>{" "}
          <span className="text-muted-foreground">{t("toast.mention.prefix")}</span>{" "}
          <span className="font-mono text-human">#{toast.room}</span>
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-muted-foreground">
          {toast.content}
        </span>
      </span>
      <ArrowRight aria-hidden className="h-3.5 w-3.5 flex-none text-muted-foreground" />
    </button>
  );
}

// The toast stack: fixed bottom-right, above the composer, pointer-events-none
// on the wrapper so the dead space doesn't intercept clicks. role=status +
// aria-live=polite announces new cross-room mentions to SR users without
// stealing focus.
export function MentionToasts({
  toasts,
  onActivate,
  onDismiss,
}: {
  toasts: MentionToast[];
  onActivate: (toast: MentionToast) => void;
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
    >
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          toast={toast}
          onActivate={onActivate}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}
