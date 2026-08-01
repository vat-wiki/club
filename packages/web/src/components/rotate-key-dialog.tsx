import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

// Rotate the current participant's login key. The current key is invalidated
// immediately; the server returns a fresh key + fresh recovery code. The caller
// (App) persists the new key (so the user stays logged in) and surfaces the new
// recovery code via the post-creation toast. This dialog is just the confirm
// step + async error surface - it does NOT handle the credential storage itself.

export function RotateKeyDialog({
  open,
  onOpenChange,
  onRotate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Perform the rotation. Resolves on success (caller updates the stored key +
   *  shows the new recovery code); rejects on server error so this dialog can
   *  surface it and stay open. */
  onRotate: () => Promise<void>;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  // Reset transient state whenever the dialog closes so a stale error doesn't
  // linger when it's reopened later.
  useEffect(() => {
    if (!open) {
      setError(false);
      setPending(false);
    }
  }, [open]);

  const handleConfirm = async () => {
    setPending(true);
    setError(false);
    try {
      await onRotate();
      onOpenChange(false);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!pending) onOpenChange(o); }}>
      <DialogContent className="max-w-[440px] gap-5" closeLabel={t("dialog.close")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-human" aria-hidden />
            {t("rotateKey.title")}
          </DialogTitle>
          <DialogDescription>{t("rotateKey.desc")}</DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {t("rotateKey.failed")}
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="outline"
            className="min-h-[44px] w-full sm:w-auto"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {t("rotateKey.cancel")}
          </Button>
          <Button
            className="min-h-[44px] w-full sm:w-auto"
            disabled={pending}
            onClick={handleConfirm}
          >
            {pending ? t("rotateKey.busy") : t("rotateKey.confirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
