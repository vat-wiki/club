import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";
import { AlertTriangle } from "lucide-react";
import { type ReactNode } from "react";

// Reusable confirmation dialog for destructive actions (delete channel, kick
// member). Replaces the native window.confirm those used to fire - same
// gate-keeping intent, but in-app, localized, styled, and keyboard/screen-reader
// friendly via Radix Dialog. Controlled by the caller: it just renders and
// fires `onConfirm` (which the caller wires to the real action + close).
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive = true,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Long-form explanation shown under the title. Either this or `children`. */
  description?: ReactNode;
  /** Label for the confirm button (already-localized by the caller). */
  confirmLabel: string;
  onConfirm: () => void;
  /** Destructive renders the confirm button in the destructive style. */
  destructive?: boolean;
  /** Optional custom body (e.g. a form) in place of `description`. */
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px] gap-5" closeLabel={t("dialog.close")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {destructive && <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />}
            {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            className="min-h-[44px] w-full sm:w-auto"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            className="min-h-[44px] w-full sm:w-auto"
            onClick={onConfirm}
            data-testid="confirm-confirm"
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
