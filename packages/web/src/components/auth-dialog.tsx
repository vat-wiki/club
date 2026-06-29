import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { api, createParticipant } from "@/lib/api";
import { API_URL } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/language-switcher";

type Mode = "create" | "paste";

export function AuthDialog({
  open,
  // Fired after a brand-new identity is minted. The app intercepts this to
  // reveal the key before persisting it, so the user actually sees (and can
  // save) the only credential that lets them back in.
  onCreated,
  // Fired after an existing key is validated. Goes straight in — the user
  // already had the key, so there's nothing to reveal.
  onAuthed,
}: {
  open: boolean;
  onCreated: (key: string) => void;
  onAuthed: (key: string) => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<Mode>("create");
  const [name, setName] = useState("");
  const [pasteKey, setPasteKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const keyInputRef = useRef<HTMLInputElement>(null);

  const create = async () => {
    setError("");
    if (!name.trim()) {
      setError(t("auth.nameRequired"));
      return;
    }
    setBusy(true);
    try {
      const { key } = await createParticipant(API_URL, name.trim(), "human");
      // Hand the freshly-minted key to the app WITHOUT persisting it; the app
      // shows the "your login key" reveal and only saves once the user
      // acknowledges they've saved it.
      onCreated(key);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Validate the pasted key before handing it to the app: call /me to confirm
  // it's recognized, so an invalid key produces an inline error instead of
  // flashing an empty app and silently reopening the dialog.
  const paste = async () => {
    setError("");
    const key = pasteKey.trim();
    if (!key) {
      setError(t("auth.pasteRequired"));
      return;
    }
    setBusy(true);
    try {
      await api.me({ server: API_URL, key });
      onAuthed(key);
    } catch {
      setError(t("auth.keyUnrecognized"));
      setPasteKey("");
      requestAnimationFrame(() => keyInputRef.current?.focus());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      // Never close via outside interaction / Esc until authenticated; the
      // app controls open state. Ignore any close attempt.
      onOpenChange={(o) => {
        if (!o) return;
      }}
    >
      <DialogContent
        className="max-w-[420px] gap-5"
        // not dismissible until authenticated
        showClose={false}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {/* Language switcher on the auth dialog too: a first-time visitor on an
            English-locale browser lands on an English onboarding and — since the
            topbar (which hosts the switcher) only renders once authenticated —
            had no way back to Chinese without first minting an identity. This
            mirrors the /join page, which already exposes a lang toggle. */}
        <div className="absolute right-3 top-3">
          <LanguageSwitcher />
        </div>
        <DialogHeader>
          <DialogTitle>
            club<span className="text-agent">.</span>
          </DialogTitle>
          <DialogDescription>
            {mode === "create" ? t("auth.desc.create") : t("auth.desc.paste")}
          </DialogDescription>
        </DialogHeader>

        {mode === "create" ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t("auth.field.nickname")}</Label>
              <Input
                id="name"
                value={name}
                maxLength={40}
                placeholder={t("auth.field.nicknamePlaceholder")}
                autoComplete="off"
                aria-required="true"
                aria-invalid={!!error}
                aria-describedby={error ? "key-error" : undefined}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && create()}
              />
            </div>
            <Button className="w-full" disabled={busy} onClick={create}>
              {busy ? t("auth.join.busy") : t("auth.join")}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="key">{t("auth.field.pasteKey")}</Label>
              <Input
                ref={keyInputRef}
                id="key"
                value={pasteKey}
                placeholder="club_…"
                autoComplete="off"
                aria-invalid={!!error}
                aria-describedby={error ? "key-error" : undefined}
                onChange={(e) => setPasteKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && paste()}
              />
            </div>
            <Button className="w-full" disabled={busy} onClick={paste}>
              {busy ? t("auth.enter.busy") : t("auth.enter")}
            </Button>
          </div>
        )}

        {error && (
          <p id="key-error" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <button
          type="button"
          className="text-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          onClick={() => {
            setError("");
            setMode(mode === "create" ? "paste" : "create");
          }}
        >
          {mode === "create" ? t("auth.switchToPaste") : t("auth.switchToCreate")}
        </button>
      </DialogContent>
    </Dialog>
  );
}
