import { AlertTriangle, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

// A draft attachment: a chosen image working its way through upload. Lived
// entirely in Composer state until sent; the server only ever sees the `id`
// of a finished (done) upload via send(). `objectUrl` is revoked after send or
// removal to avoid leaking blob URLs.
export interface AttachmentDraft {
  // Stable client-side key (React list key), independent of array index so
  // reordering on delete doesn't remount sibling chips.
  key: string;
  file: File;
  objectUrl: string;
  status: "uploading" | "done" | "error";
  progress: number; // 0..1, only meaningful while uploading
  remote?: { id: string }; // the server id, set once status === "done"
}

// One 64px thumbnail chip with upload-progress / error overlays and a 44×44
// remove control. Pure-presentational — all state lives in the parent, which
// passes onRemove / onRetry. a11y:
//   - the container is a plain div (NO role): it holds interactive buttons, so
//     giving it role="img" would create a nested-interactive violation (axe
//     `nested-interactive`). Instead the status ("Image 2, uploading 60%" /
//     "Image 2, upload failed") is carried by the <img>'s alt — SRs announce
//     the preview and its state from the image itself.
//   - the remove + retry buttons are real <button>s with their own aria-labels.
//   - a visually-hidden live region mirrors progress so SRs stream updates
//     without the user revisiting the chip.
export function ImagePreviewChip({
  draft,
  labelDone,
  labelUploading,
  labelError,
  removeLabel,
  retryLabel,
  onRemove,
  onRetry,
}: {
  draft: AttachmentDraft;
  labelDone: string;
  labelUploading: (percent: number) => string;
  labelError: string;
  removeLabel: string;
  retryLabel: string;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const percent = Math.round(draft.progress * 100);
  const statusAlt =
    draft.status === "uploading"
      ? labelUploading(percent)
      : draft.status === "error"
        ? labelError
        : labelDone;

  return (
    <div
      // Chip enter animation (design §4.1): zoom+fade, 200ms, out-quint — the
      // same curve as Dialog open, just faster. The inline timing function
      // keeps it on-brand even though tailwindcss-animate's animate-in uses
      // the Material default. motion-reduce collapses via the global wildcard.
      className="group relative h-16 w-16 animate-in fade-in-0 zoom-in-95 overflow-hidden rounded-md border border-border bg-muted [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] duration-200"
    >
      <img
        src={draft.objectUrl}
        // The thumbnail's alt carries the chip's state for SRs ("Image 1,
        // uploading 60%"). This is the accessible name for the preview, kept
        // out of the container (which also holds buttons) to avoid
        // nested-interactive.
        alt={statusAlt}
        className="h-full w-full object-cover"
        // Don't let a drag of the thumbnail start a ghost-image drag that
        // confuses our own drop handler on the composer.
        draggable={false}
      />

      {/* Upload-in-progress overlay: a subtle scrim + spinner + a 2px mint
          progress bar pinned to the bottom. The progress bar uses mint because
          it's the "processing" channel signal, and stays small enough not to
          compete with the image content. */}
      {draft.status === "uploading" && (
        <div
          className="absolute inset-0 grid place-items-center bg-background/60 backdrop-blur-[2px]"
          aria-hidden
        >
          <Loader2 className="h-4 w-4 animate-spin text-foreground" />
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-agent/25">
            <div
              className="h-full bg-agent transition-[width] duration-200 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Error overlay: destructive wash + alert icon. The whole chip is a
          retry affordance (click to retry), with a separate remove control. */}
      {draft.status === "error" && (
        <button
          type="button"
          onClick={onRetry}
          aria-label={retryLabel}
          className="absolute inset-0 grid place-items-center bg-destructive/15 text-destructive transition-colors hover:bg-destructive/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <AlertTriangle className="h-4 w-4" aria-hidden />
        </button>
      )}

      {/* Live region mirroring progress text, so SRs announce upload advances
          without the user having to revisit the chip. Empty when not uploading
          so it stops talking once done. */}
      <div className="sr-only" aria-live="polite">
        {draft.status === "uploading" ? labelUploading(percent) : ""}
      </div>

      {/* Remove (×) — always present so a failed or done image can be dropped.
          The hit target is the full 44×44 (WCAG 2.5.5); only the inner 20px
          circle is visually filled, so the control reads as a small top-right
          close pill while staying easy to tap. Position its center on the
          chip's top-right corner so the visible dot sits on the edge. */}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="absolute -right-[10px] -top-[10px] grid h-11 w-11 place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className={cn(
            "grid h-5 w-5 place-items-center rounded-full bg-background/80 text-foreground backdrop-blur-sm transition-colors",
            "group-hover:bg-background",
          )}
        >
          <X className="h-3 w-3" aria-hidden />
        </span>
      </button>
    </div>
  );
}
