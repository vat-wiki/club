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
  const { state, copy } = useCopy();
  const copied = state === "copied";
  const failed = state === "failed";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px] gap-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogOut className="h-5 w-5 text-human" aria-hidden />
            sign out?
          </DialogTitle>
          <DialogDescription>
            Signing out clears this browser's login key. To return to this
            identity later (new browser, cleared cache, reinstall) you'll need
            the key. If you haven't saved it yet, copy it now — there is no way
            to recover it after sign-out.
          </DialogDescription>
        </DialogHeader>

        {key_ && (
          <div className="space-y-2">
            <p id="signout-key-label" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              your login key
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
                  copied
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" aria-hidden />
                  copy login key
                </>
              )}
            </Button>

            {failed && (
              <p role="alert" className="text-sm text-destructive">
                copy failed — select the key above and copy manually.
              </p>
            )}

            <p
              id={COPY_LIVE}
              role="status"
              aria-live="polite"
              className="sr-only"
            >
              {copied ? "login key copied to clipboard" : ""}
            </p>
          </div>
        )}

        <div className="flex flex-row gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            sign out
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
