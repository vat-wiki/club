import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { MAX_BIO } from "@club/shared";

// Inline, expandable bio editor shared by the settings Account section (self)
// and the Members section (any participant, open model). Collapsed it shows the
// current bio (or a muted "not set") with an edit affordance; expanded it
// becomes a textarea with a live char count, inline error, and Cmd/Ctrl+Enter
// to save. `onSave` may throw - the message is surfaced inline and the editor
// stays open so the user can fix and retry.
export function BioEditor({
  bio,
  onSave,
  editLabel,
  emptyText,
  testId,
  className,
}: {
  bio: string;
  /** Persist the new bio. Throw to surface an inline error (editor stays open). */
  onSave: (bio: string) => Promise<void> | void;
  /** Accessible name for the edit trigger. Defaults to the generic "Edit bio". */
  editLabel?: string;
  /** Text shown when the bio is empty. Defaults to the generic "Not set". */
  emptyText?: string;
  testId?: string;
  className?: string;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(bio);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Re-seed from the latest bio each time we open so a previous edit (or a
  // server-side change) doesn't linger, and focus the textarea for keyboard
  // flow.
  useEffect(() => {
    if (editing) {
      setValue(bio);
      setError("");
      requestAnimationFrame(() => ref.current?.focus());
    }
  }, [editing, bio]);

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await onSave(value);
      setEditing(false);
    } catch (e) {
      // The server validates bio (length, single-line); surface the message
      // inline and keep the editor open so the user can fix and retry.
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className={cn("space-y-2", className)}>
        <div className="flex items-center justify-between">
          <Label htmlFor={`bio-editor-${testId ?? "x"}`}>{t("profile.bioLabel")}</Label>
          <span className="font-mono text-xs text-muted-foreground" aria-live="polite">
            {value.length}/{MAX_BIO}
          </span>
        </div>
        <Textarea
          ref={ref}
          id={`bio-editor-${testId ?? "x"}`}
          value={value}
          maxLength={MAX_BIO}
          disabled={busy}
          placeholder={t("profile.bioPlaceholder")}
          aria-describedby={`bio-editor-hint-${testId ?? "x"}`}
          data-testid={`bio-editor-input-${testId ?? "x"}`}
          className="min-h-[72px]"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter saves (Enter alone inserts a newline, as expected
            // for a textarea). The server strips newlines anyway.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
        />
        <p id={`bio-editor-hint-${testId ?? "x"}`} className="text-xs text-muted-foreground">
          {t("profile.bioHint", { max: MAX_BIO })}
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            className="min-h-[40px]"
            disabled={busy}
            onClick={() => setEditing(false)}
          >
            {t("profile.cancel")}
          </Button>
          <Button className="min-h-[40px]" disabled={busy} onClick={save} data-testid={`bio-editor-save-${testId ?? "x"}`}>
            {busy ? t("profile.saving") : t("profile.save")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex min-w-0 items-center justify-between gap-2", className)}>
      <span className={cn("min-w-0 truncate text-sm", bio ? "text-muted-foreground" : "text-muted-foreground/50")}>
        {bio || (emptyText ?? t("bio.empty"))}
      </span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={editLabel ?? t("bio.edit")}
        title={editLabel ?? t("bio.edit")}
        data-testid={`bio-edit-${testId ?? "x"}`}
        className="flex h-7 flex-none items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Pencil aria-hidden className="h-3 w-3" />
        {t("bio.edit")}
      </button>
    </div>
  );
}
