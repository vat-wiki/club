import { useEffect, useRef } from "react";
import { AlertTriangle, Copy, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/hooks/use-copy";

// Shown right after a brand-new identity is minted. The app has NOT persisted
// the key yet — it only does so once the user clicks "I've saved it". This is
// the deliberate friction point: losing the key means losing the identity
// permanently, so we force the user to at least look at it once.

const COPY_LIVE = "key-reveal-copy-status";

export function KeyRevealDialog({
  open,
  key_,
  onSaved,
}: {
  open: boolean;
  key_: string;
  // Called once the user acknowledges they've saved the key. The app then
  // persists the key and enters the room.
  onSaved: () => void;
}) {
  const { state, copy } = useCopy();
  const savedRef = useRef<HTMLButtonElement>(null);

  // Move focus into the dialog's primary action on open so keyboard users land
  // somewhere useful (Radix focuses the content by default; we promote the
  // "copy" button since that's the action the user most needs to take first).
  useEffect(() => {
    if (open) {
      // Defer a frame so Radix has mounted the content + set up its focus trap.
      const id = requestAnimationFrame(() => {
        // Focus the copy button — the copy action is the critical next step,
        // and Copy is the affordance we most want keyboard users to hit first.
        const btn = document.querySelector<HTMLButtonElement>(
          "[data-key-copy-btn]",
        );
        btn?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  const copied = state === "copied";
  const failed = state === "failed";

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-[460px] gap-5"
        // Not dismissible until acknowledged — Esc / outside click would
        // silently drop the only chance to record the key.
        showClose={false}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-human" aria-hidden />
            save your login key
          </DialogTitle>
          <DialogDescription>
            This is the only credential that lets you back into this identity.
            Save it somewhere safe — club does not store it for you, and it
            cannot be recovered if lost.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <p id="key-reveal-label" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              your login key
            </p>
            {/* Break-all so the long key wraps instead of overflowing on
                narrow viewports; font-mono so it's unambiguous. */}
            <output
              aria-labelledby="key-reveal-label"
              className="block w-full break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-sm text-foreground"
            >
              {key_}
            </output>
          </div>

          <div className="flex flex-col gap-2">
            <Button
              ref={savedRef}
              data-key-copy-btn
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

            {/* aria-live region for the copy success announcement. Exists in
                the DOM up-front (empty when idle) so SRs start observing it. */}
            <p
              id={COPY_LIVE}
              role="status"
              aria-live="polite"
              className="sr-only"
            >
              {copied ? "login key copied to clipboard" : ""}
            </p>
          </div>
        </div>

        <Button className="w-full" onClick={onSaved}>
          i've saved it — enter
        </Button>
      </DialogContent>
    </Dialog>
  );
}
