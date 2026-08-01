import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";
import { AlertTriangle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

// Self-delete the current participant's account. Two-factor: the current login
// key is the password (sent automatically by the caller), and the recovery code
// is the second factor - entered here. On success the caller clears all local
// state and returns to the auth dialog. Destructive: red styling + confirm
// wording. The account is soft-deleted; authored messages are preserved.

export function DeleteAccountDialog({
  open,
  onOpenChange,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Perform the deletion with the user-entered recovery code. Resolves on
   *  success (caller clears state + returns to auth); rejects on server error
   *  (wrong recovery code) so this dialog can surface it and stay open. */
  onDelete: (recoverCode: string) => Promise<void>;
}) {
  const t = useT();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  // Reset the form whenever the dialog closes so a stale code/error doesn't
  // linger when it's reopened later.
  useEffect(() => {
    if (!open) {
      setCode("");
      setError(false);
      setPending(false);
    }
  }, [open]);

  const handleConfirm = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setPending(true);
    setError(false);
    try {
      await onDelete(trimmed);
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
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" aria-hidden />
            {t("deleteAccount.title")}
          </DialogTitle>
          <DialogDescription>{t("deleteAccount.desc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <label
            htmlFor="delete-account-code"
            className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
          >
            {t("deleteAccount.field.code")}
          </label>
          <input
            id="delete-account-code"
            type="text"
            value={code}
            disabled={pending}
            onChange={(e) => {
              setCode(e.target.value);
              setError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleConfirm();
              }
            }}
            placeholder={t("deleteAccount.field.codePlaceholder")}
            autoComplete="off"
            spellCheck={false}
            className="block w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">{t("deleteAccount.hint")}</p>
        </div>

        {error && (
          <p role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {t("deleteAccount.failed")}
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="outline"
            className="min-h-[44px] w-full sm:w-auto"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {t("deleteAccount.cancel")}
          </Button>
          <Button
            variant="destructive"
            className="min-h-[44px] w-full sm:w-auto"
            disabled={pending || !code.trim()}
            onClick={handleConfirm}
          >
            {pending ? t("deleteAccount.busy") : t("deleteAccount.confirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
