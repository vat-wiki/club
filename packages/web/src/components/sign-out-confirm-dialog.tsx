import { LogOut, Copy, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/hooks/use-copy";
import { useT } from "@/lib/i18n";

// Confirmation shown before sign-out. clearConn wipes the key from this
// machine, so we give the user one last chance to copy it. Without this, a
// reflexive sign-out permanently orphans the identity.

const COPY_LIVE = "signout-copy-status";

export function SignOutConfirmDialog({
  open,
  onOpenChange,
  key_,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  key_: string | null;
  onConfirm: () => void;
}) {
  const t = useT();
  const { state, copy } = useCopy();
  const copied = state === "copied";
  const failed = state === "failed";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px] gap-5" closeLabel={t("dialog.close")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogOut className="h-5 w-5 text-human" aria-hidden />
            {t("signOut.title")}
          </DialogTitle>
          <DialogDescription>{t("signOut.desc")}</DialogDescription>
        </DialogHeader>

        {key_ && (
          <div className="space-y-2">
            <p id="signout-key-label" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("signOut.label")}
            </p>
            <output
              aria-labelledby="signout-key-label"
              className="block w-full break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-sm text-foreground"
            >
              {key_}
            </output>
            <Button
              variant={copied ? "outline" : "secondary"}
              className="w-full gap-2"
              onClick={() => copy(key_)}
              aria-describedby={COPY_LIVE}
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4" aria-hidden />
                  {t("signOut.copied")}
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" aria-hidden />
                  {/* "Copy first" framing makes the inline copy read as a
                      deliberate pre-sign-out step, not a stray utility: one
                      tap copies the key without leaving this dialog. */}
                  {t("signOut.copyFirst")}
                </>
              )}
            </Button>

            {failed && (
              <p role="alert" className="text-sm text-destructive">
                {t("signOut.copyFailed")}
              </p>
            )}

            <p
              id={COPY_LIVE}
              role="status"
              aria-live="polite"
              className="sr-only"
            >
              {copied ? t("signOut.copyAnnounced") : ""}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <Button variant="outline" className="min-h-[44px] w-full sm:w-auto" onClick={() => onOpenChange(false)}>
            {t("signOut.cancel")}
          </Button>
          <Button variant="destructive" className="min-h-[44px] w-full sm:w-auto" onClick={onConfirm}>
            {t("signOut.confirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
