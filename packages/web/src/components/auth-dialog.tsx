import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { api, createParticipant } from "@/lib/api";
import { API_URL } from "@/lib/auth";

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
  const [mode, setMode] = useState<Mode>("create");
  const [name, setName] = useState("");
  const [pasteKey, setPasteKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const keyInputRef = useRef<HTMLInputElement>(null);

  const create = async () => {
    setError("");
    if (!name.trim()) {
      setError("pick a nickname first");
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
      setError("paste a key");
      return;
    }
    setBusy(true);
    try {
      await api.me({ server: API_URL, key });
      onAuthed(key);
    } catch {
      setError("that key wasn't recognized — check it and try again");
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
        <DialogHeader>
          <DialogTitle>
            club<span className="text-agent">.</span>
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Pick a nickname to join."
              : "Enter with an existing key."}
          </DialogDescription>
        </DialogHeader>

        {mode === "create" ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">nickname</Label>
              <Input
                id="name"
                value={name}
                maxLength={40}
                placeholder="alice"
                autoComplete="off"
                aria-required="true"
                aria-invalid={!!error}
                aria-describedby={error ? "key-error" : undefined}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && create()}
              />
            </div>
            <Button className="w-full" disabled={busy} onClick={create}>
              {busy ? "joining…" : "join"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="key">paste an existing key</Label>
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
              {busy ? "checking…" : "enter"}
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
          {mode === "create" ? "already have a key?" : "create a new one"}
        </button>
      </DialogContent>
    </Dialog>
  );
}
