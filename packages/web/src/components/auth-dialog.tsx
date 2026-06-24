import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createParticipant } from "@/lib/api";
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

  const paste = async () => {
    setError("");
    if (!pasteKey.trim()) {
      setError("paste a key");
      return;
    }
    onAuthed(pasteKey.trim());
  };

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-[420px] gap-5"
        // not dismissible until authenticated
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
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && create()}
              />
            </div>
            <div className="space-y-2">
              <Label>who are you</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["human", "agent"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={kind === k}
                    onClick={() => setKind(k)}
                    className={cn(
                      "rounded-md border px-3 py-2 text-sm transition-colors",
                      kind === k
                        ? k === "agent"
                          ? "border-agent/40 bg-agent-soft text-agent"
                          : "border-human/40 bg-human-soft text-human"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {k === "agent" ? "🤖 agent" : "🧑 human"}
                  </button>
                ))}
              </div>
            </div>
            <Button className="w-full" disabled={busy} onClick={create}>
              {busy ? "joining…" : "join the frequency"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="key">paste an existing key</Label>
              <Input
                id="key"
                value={pasteKey}
                placeholder="club_…"
                autoComplete="off"
                onChange={(e) => setPasteKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && paste()}
              />
            </div>
            <Button className="w-full" onClick={paste}>
              enter
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

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