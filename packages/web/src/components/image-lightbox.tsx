import { ChevronLeft, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";

export interface LightboxImage {
  src: string;
  alt: string;
}

// A lightbox built on the project's existing Radix Dialog (design §4.5) — it
// already ships the bg-black/80 overlay, zoom-95/fade/300ms/out-quint open
// animation, Esc-to-close, and overlay-click-to-close. We drop the
// DialogContent chrome (no card bg/border/shadow/padding/ring) so the image
// itself is the edge — no inner padding, no rounded corners. A single-image
// caller passes a one-element list; a gallery passes every image and the
// lightbox adds prev/next (chevron buttons + ←/→ keyboard) with a position
// readout. The DialogTitle/Description are visually-hidden so the dialog still
// has an accessible name (Radix requires a Title; without it axe flags
// `aria-dialog-name`).
export function ImageLightbox({
  images,
  index,
  onIndexChange,
}: {
  images: LightboxImage[];
  // The currently shown image index, or null when closed. Controlled by the
  // caller (the gallery) so its thumbnails and the lightbox stay in sync.
  index: number | null;
  onIndexChange: (index: number | null) => void;
}) {
  const t = useT();
  const open = index != null && images.length > 0;
  const safeIndex = index == null ? 0 : Math.min(index, images.length - 1);
  const current = open ? images[safeIndex] : null;
  const multi = images.length > 1;
  const atFirst = safeIndex === 0;
  const atLast = safeIndex === images.length - 1;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onIndexChange(null);
      }}
    >
      <DialogContent
        // Override the default card chrome for a pure lightbox look. No
        // padding, no border, no shadow, no ring, transparent bg — the image is
        // the frame edge (the user asked for no inner padding around it). The
        // inherited zoom/fade + out-quint easing still apply.
        closeLabel={t("dialog.close")}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowLeft" && !atFirst) onIndexChange(safeIndex - 1);
          else if (e.key === "ArrowRight" && !atLast) onIndexChange(safeIndex + 1);
        }}
        className="max-w-[98vw] gap-0 border-0 bg-transparent p-0 shadow-none"
      >
        <DialogTitle className="sr-only">{t("image.lightbox.title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("image.lightbox.desc")}</DialogDescription>
        {current && (
          /* The image is intentionally NOT a close affordance (design §4.5) —
             clicking it does nothing; only the overlay / Esc / X / arrows act.
             No rounded corners: the image edge IS the preview edge. */
          <img
            src={current.src}
            alt={current.alt}
            data-testid="lightbox-image"
            className="mx-auto max-h-[94vh] w-auto max-w-full object-contain"
            draggable={false}
          />
        )}
        {multi && open && current && (
          <>
            <button
              type="button"
              onClick={() => onIndexChange(safeIndex - 1)}
              disabled={atFirst}
              aria-label={t("image.lightbox.prev")}
              data-testid="lightbox-prev"
              className="absolute left-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:pointer-events-none disabled:opacity-25"
            >
              <ChevronLeft className="h-6 w-6" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => onIndexChange(safeIndex + 1)}
              disabled={atLast}
              aria-label={t("image.lightbox.next")}
              data-testid="lightbox-next"
              className="absolute right-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:pointer-events-none disabled:opacity-25"
            >
              <ChevronRight className="h-6 w-6" aria-hidden />
            </button>
            {/* Position readout ("2 / 5"). aria-live so SR users hear which
                image they landed on after a prev/next, mirroring the visual. */}
            <div
              aria-live="polite"
              className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-2.5 py-0.5 font-mono text-xs text-white backdrop-blur-sm"
            >
              {safeIndex + 1} / {images.length}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
