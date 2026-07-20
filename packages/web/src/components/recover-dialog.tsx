import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recoverParticipant } from "@/lib/api";
import { API_URL } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { LifeBuoy } from "lucide-react";
import { useRef, useState } from "react";

// Recover an existing identity by nickname + one-time recovery code. Reached
// from the AuthDialog paste path as a *secondary* entry (not a third main
// route — see PRD §8.2): most users mint a new identity or paste an existing
// key; "I lost the key but saved the recovery code" is the rare fallback.
//
// On success the server reissues a fresh key AND a fresh recovery code, reusing
// the original participant id + name. We hand the new key straight to onAuthed
// (no reveal dialog: the user is recovering, not minting — they already know
// to save credentials). The rotated recovery code is surfaced to the caller so
// it can prompt the user to save the new one; for now we rely on the next
// view-key / sign-out copy flow.

export function RecoverDialog({
  open,
  onOpenChange,
  onRecovered,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Fired with the freshly reissued key (and, for future surfacing, the new
  // recovery code) once recovery succeeds. The app persists + enters the room.
  onRecovered: (key: string, recoverCode: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    setError("");
    if (!name.trim() || !code.trim()) {
      setError(t("recover.failed"));
      return;
    }
    setBusy(true);
    try {
      const { key, recoverCode } = await recoverParticipant(API_URL, {
        name: name.trim(),
        recoverCode: code.trim(),
      });
      onRecovered(key, recoverCode);
    } catch {
      // The server returns a uniform 401 for both "wrong code" and "unknown
      // name" (to prevent callsign enumeration), so the message is identical.
      setError(t("recover.failed"));
      requestAnimationFrame(() => nameRef.current?.focus());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Reset transient form/error state when the user dismisses, so a later
        // re-open doesn't show a stale error or the previous recovery code.
        if (!o) {
          setError("");
          setCode("");
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-[420px] gap-5" closeLabel={t("dialog.close")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LifeBuoy className="h-5 w-5 text-human" aria-hidden />
            {t("recover.title")}
          </DialogTitle>
          <DialogDescription>{t("recover.desc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="recover-name">{t("recover.field.name")}</Label>
            <Input
              ref={nameRef}
              id="recover-name"
              value={name}
              maxLength={40}
              placeholder={t("recover.field.namePlaceholder")}
              autoComplete="off"
              aria-required="true"
              aria-invalid={!!error}
              aria-describedby={error ? "recover-error" : undefined}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="recover-code">{t("recover.field.code")}</Label>
            <Input
              id="recover-code"
              value={code}
              className="font-mono"
              placeholder={t("recover.field.codePlaceholder")}
              autoComplete="off"
              aria-required="true"
              aria-invalid={!!error}
              aria-describedby={error ? "recover-error" : undefined}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          <Button className="w-full" disabled={busy} onClick={submit}>
            {busy ? t("recover.busy") : t("recover.submit")}
          </Button>
        </div>

        {error && (
          <p id="recover-error" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
