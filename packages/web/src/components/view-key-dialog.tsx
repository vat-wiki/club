import { useState } from "react";
import { Key, Copy, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/hooks/use-copy";

// Lets an already-signed-in user view + copy their own login key at any time.
// The key lives in localStorage (club_key); this is the "I skipped saving it
// at reveal time, give me another chance" escape hatch.

const COPY_LIVE = "viewkey-copy-status";

export function ViewKeyDialog({ key_ }: { key_: string | null }) {
  const [open, setOpen] = useState(false);
  const { state, copy, reset } = useCopy();
  const copied = state === "copied";
  const failed = state === "failed";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        // Reset copy feedback each time the dialog closes so a stale
        // "copied" doesn't linger when it's reopened later.
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="tap-target inline-flex items-center justify-center rounded-md border border-border bg-transparent px-2 text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label="view your login key"
          title="your login key"
        >
          <Key className="h-3.5 w-3.5" aria-hidden />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-[440px] gap-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5 text-human" aria-hidden />
            your login key
          </DialogTitle>
          <DialogDescription>
            This is your identity's only credential. Save it somewhere safe —
            you'll need it to come back from a new browser or after clearing
            cache. club can't recover it for you.
          </DialogDescription>
        </DialogHeader>

        {key_ ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <p id="viewkey-label" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                login key
              </p>
              <output
                aria-labelledby="viewkey-label"
                className="block w-full break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-sm text-foreground"
              >
                {key_}
              </output>
            </div>

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
        ) : (
          <p className="text-sm text-muted-foreground">no key found.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
