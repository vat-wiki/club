import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";

import { MAX_BIO } from "@club/shared";

// Edit the authenticated participant's own bio (self-introduction / role
// description). Category-blind: the SAME field serves humans and agents - club
// never classifies participants, so "what's my role" is something each
// participant writes for themselves (see .pd-docs/requirements/category-blind.md).
//
// The dialog is a controlled shell: the parent owns `open`/`currentBio` and
// performs the actual PATCH via `onSave` (which may throw - surfaced inline).
// On a successful save the parent closes the dialog and refreshes the roster.
export function EditProfileDialog({
  open,
  onOpenChange,
  currentBio,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bio shown when the dialog opens; re-synced each open in case it changed. */
  currentBio: string;
  /** Persist the new bio. Throw to surface an inline error (dialog stays open). */
  onSave: (bio: string) => Promise<void> | void;
}) {
  const t = useT();
  const [bio, setBio] = useState(currentBio);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Re-seed local state each time the dialog opens so a previous edit (or a
  // server-side change) doesn't linger. Also focus the textarea for keyboard
  // flow - the dialog already traps focus, so this lands on the editable field.
  useEffect(() => {
    if (open) {
      setBio(currentBio);
      setError("");
      requestAnimationFrame(() => ref.current?.focus());
    }
  }, [open, currentBio]);

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await onSave(bio);
      onOpenChange(false);
    } catch (e) {
      // The server validates bio (length, single-line); surface the message
      // inline and keep the dialog open so the user can fix and retry.
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Drop transient error/draft state on dismiss so a later re-open starts
        // clean from `currentBio` (the effect re-seeds on next open).
        if (!o) setError("");
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-[420px] gap-5" closeLabel={t("dialog.close")}>
        <DialogHeader>
          <DialogTitle>{t("profile.editTitle")}</DialogTitle>
          <DialogDescription>{t("profile.editDesc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="profile-bio">{t("profile.bioLabel")}</Label>
            {/* Live char count so the user sees the MAX_BIO cap approaching
                before the server rejects it. aria-live keeps SR users informed. */}
            <span
              className="font-mono text-xs text-muted-foreground"
              aria-live="polite"
            >
              {bio.length}/{MAX_BIO}
            </span>
          </div>
          <Textarea
            ref={ref}
            id="profile-bio"
            value={bio}
            maxLength={MAX_BIO}
            placeholder={t("profile.bioPlaceholder")}
            aria-describedby="profile-bio-hint"
            onChange={(e) => setBio(e.target.value)}
            onKeyDown={(e) => {
              // Cmd/Ctrl+Enter saves (Enter alone inserts a newline, as expected
              // for a textarea). The server strips newlines anyway, but letting
              // Enter work naturally avoids surprising keyboard users.
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void save();
              }
            }}
          />
          <p id="profile-bio-hint" className="text-xs text-muted-foreground">
            {t("profile.bioHint", { max: MAX_BIO })}
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            className="min-h-[44px] w-full sm:w-auto"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {t("profile.cancel")}
          </Button>
          <Button
            className="min-h-[44px] w-full sm:w-auto"
            onClick={save}
            disabled={busy}
          >
            {busy ? t("profile.saving") : t("profile.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
