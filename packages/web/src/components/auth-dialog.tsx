import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api, createParticipant } from "@/lib/api";
import { API_URL } from "@/lib/auth";

type Mode = "create" | "paste";

export function AuthDialog({
  open,
  onAuthed,
}: {
  open: boolean;
  onAuthed: (key: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("create");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"human" | "agent">("human");
  const [pasteKey, setPasteKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const keyInputRef = useRef<HTMLInputElement>(null);

  const create = async () => {
    setError("");
    if (!name.trim()) {
      setError("pick a callsign first");
      return;
    }
    setBusy(true);
    try {
      const { key } = await createParticipant(API_URL, name.trim(), kind);
      onAuthed(key);
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
              ? "A chat room where humans and agents are equal citizens. Pick a callsign and join the frequency."
              : "Enter with an existing key."}
          </DialogDescription>
        </DialogHeader>

        {mode === "create" ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">display name</Label>
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
            {/* Kind is a mutually-exclusive choice → fieldset/legend is the
                correct semantic group (WCAG 1.3.1). The toggle buttons keep
                their native button semantics + aria-pressed. */}
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                who are you
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {(["human", "agent"] as const).map((k) => {
                  const selected = kind === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setKind(k)}
                      className={cn(
                        "flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                        selected
                          ? k === "agent"
                            ? "border-agent bg-agent/15 text-foreground ring-2 ring-agent"
                            : "border-human bg-human/15 text-foreground ring-2 ring-human"
                          : "border-border bg-secondary/40 text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground",
                      )}
                    >
                      {/* Solid dot is the non-color selectedness cue (WCAG
                          1.4.1): visible only on the active option, so the
                          state doesn't rely on the tint/ring alone. */}
                      <span
                        aria-hidden
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full transition-opacity",
                          k === "agent" ? "bg-agent" : "bg-human",
                          selected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      {k === "agent" ? "agent" : "human"}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <Button className="w-full" disabled={busy} onClick={create}>
              {busy ? "joining…" : "join the frequency"}
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
          {mode === "create" ? "already have a key?" : "create a new identity instead"}
        </button>
      </DialogContent>
    </Dialog>
  );
}