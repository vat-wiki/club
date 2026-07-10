import { AlertTriangle, FileText, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

// A draft attachment: a chosen image OR video working its way through upload.
// Lived entirely in Composer state until sent; the server only ever sees the
// `id` of a finished (done) upload via send(). `objectUrl` is revoked after
// send or removal to avoid leaking blob URLs. `kind` drives the preview
// element (<img> vs <video>) — the rest of the chip (progress/error/remove) is
// identical for both, so one component renders either.
export interface AttachmentDraft {
  // Stable client-side key (React list key), independent of array index so
  // reordering on delete doesn't remount sibling chips.
  key: string;
  file: File;
  objectUrl: string;
  kind: "image" | "video" | "document";
  status: "uploading" | "done" | "error";
  progress: number; // 0..1, only meaningful while uploading
  remote?: { id: string }; // the server id, set once status === "done"
}

// One 64px thumbnail chip with upload-progress / error overlays and a 44×44
// remove control. Renders an <img> for images or a muted <video> (first frame)
// for videos. Pure-presentational — all state lives in the parent, which
// passes onRemove / onRetry. a11y:
//   - the container is a plain div (NO role): it holds interactive buttons, so
//     giving it role="img" would create a nested-interactive violation (axe
//     `nested-interactive`). Instead the status ("Image 2, uploading 60%" /
//     "Video 1, upload failed") is carried by the preview element's alt/label.
//   - the remove + retry buttons are real <button>s with their own aria-labels.
//   - a visually-hidden live region mirrors progress so SRs stream updates
//     without the user revisiting the chip.
export function MediaPreviewChip({
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
      // same curve as Dialog open, just faster. motion-reduce collapses via the
      // global wildcard.
      className="group relative h-16 w-16 animate-in fade-in-0 zoom-in-95 overflow-hidden rounded-md border border-border bg-muted [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] duration-200"
    >
      {draft.kind === "video" ? (
        // muted + preload="metadata" + playsInline so the first frame renders as
        // a still poster (no autoplay, no audio) while the file is still only a
        // local draft. aria-label carries the chip's state for SRs, mirroring
        // the image chip's alt.
        <video
          src={draft.objectUrl}
          aria-label={statusAlt}
          muted
          preload="metadata"
          playsInline
          tabIndex={-1}
          className="h-full w-full object-cover"
        />
      ) : draft.kind === "document" ? (
        // Document chips show a file icon + filename instead of a preview frame
        // (the bytes aren't an inline-renderable image/video). role=img +
        // aria-label carry the state for SRs, mirroring the other paths.
        <div
          role="img"
          aria-label={statusAlt}
          className="flex h-full w-full flex-col items-center justify-center gap-0.5 px-1 text-center"
        >
          <FileText className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="w-full truncate font-mono text-[9px] leading-tight text-muted-foreground">
            {draft.file.name}
          </span>
        </div>
      ) : (
        <img
          src={draft.objectUrl}
          alt={statusAlt}
          // Don't let a drag of the thumbnail start a ghost-image drag that
          // confuses our own drop handler on the composer.
          draggable={false}
          className="h-full w-full object-cover"
        />
      )}

      {/* Upload-in-progress overlay: a subtle scrim + spinner + a 2px mint
          progress bar pinned to the bottom. */}
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

      {/* A small ▶ badge on finished video chips so the kind is legible at a
          glance even when the first frame is dark/black. Pointer-events none so
          it never blocks the (absent) click target — videos play in the message
          list, not the draft chip. */}
      {draft.kind === "video" && draft.status === "done" && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-0.5 right-0.5 grid h-4 w-4 place-items-center rounded-full bg-background/80 text-foreground"
        >
          <svg viewBox="0 0 24 24" className="h-2.5 w-2.5 fill-current" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      )}

      {/* Remove (×) — always present so a failed or done file can be dropped.
          The hit target is the full 44×44 (WCAG 2.5.5); only the inner 20px
          circle is visually filled. */}
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
