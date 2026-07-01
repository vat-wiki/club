import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";

// A lightbox built on the project's existing Radix Dialog (design §4.5) — it
// already ships the bg-black/80 overlay, zoom-95/fade/300ms/out-quint open
// animation, Esc-to-close, and overlay-click-to-close. We only override the
// DialogContent chrome (drop the card bg/border/shadow/padding) and center an
// object-contain image. The DialogTitle/Description are visually-hidden so the
// dialog still has an accessible name (Radix requires a Title; without it the
// dialog is announced as unlabeled and axe flags `aria-dialog-name`).
export function ImageLightbox({
  src,
  alt,
  open,
  onOpenChange,
}: {
  src: string;
  alt: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Override the default card chrome for a pure lightbox look. The
        // inherited zoom/fade + out-quint easing still apply. A hairline
        // ring-white/10 gives the image edge a "held" feel on pure black.
        className="max-w-[90vw] gap-0 border-0 bg-transparent p-0 shadow-none ring-white/10"
        closeLabel={t("dialog.close")}
      >
        <DialogTitle className="sr-only">{t("image.lightbox.title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("image.lightbox.desc")}</DialogDescription>
        {open && (
          /* The image is intentionally NOT a close affordance (design §4.5) —
             clicking it does nothing, only the overlay / Esc / X close. */
          <img
            src={src}
            alt={alt}
            data-testid="lightbox-image"
            className="mx-auto max-h-[85vh] w-auto max-w-full object-contain rounded-md"
            draggable={false}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
