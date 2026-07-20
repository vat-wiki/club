import { LanguageSwitcher } from "@/components/language-switcher";
import { RecoverDialog } from "@/components/recover-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, createParticipant } from "@/lib/api";
import { API_URL } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { isBlockingIssue, NICKNAME_RULE,validateNickname } from "@/lib/nickname";
import { AlertTriangle } from "lucide-react";
import { useMemo, useRef, useState } from "react";

type Mode = "create" | "paste";

export function AuthDialog({
  open,
  // Fired after a brand-new identity is minted. The app intercepts this to
  // reveal the key before persisting it, so the user actually sees (and can
  // save) the only credential that lets them back in. Carries the one-time
  // recovery code too — shown alongside the key on the reveal dialog.
  onCreated,
  // Fired after an existing key is validated (paste path). Goes straight in —
  // the user already had the key, so there's nothing to reveal.
  onAuthed,
  // Fired after an identity is *recovered* (callsign + one-time recovery code).
  // The server reissues a FRESH key AND a fresh recovery code; the app intercepts
  // this — exactly like onCreated — to reveal the new pair before persisting,
  // because the user must record the new credentials (the recovery code they
  // just used is single-use and now dead, and the old key is rotated off).
  // Defaults to onAuthed for backward compatibility (older callers that don't
  // care about surfacing the rotated pair).
  onRecovered,
}: {
  open: boolean;
  onCreated: (key: string, recoverCode: string) => void;
  onAuthed: (key: string) => void;
  onRecovered?: (key: string, recoverCode: string) => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<Mode>("create");
  const [name, setName] = useState("");
  const [pasteKey, setPasteKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // "Recover identity" is a secondary entry off the paste path (PRD §8.2: not
  // a third main route). It opens its own dialog on top of this one.
  const [recoverOpen, setRecoverOpen] = useState(false);
  // Brief shake animation when the user tries to submit a blocked nickname
  // (e.g. one with spaces). Reset on the next change. Respects
  // prefers-reduced-motion via the global wildcard in index.css.
  const [shake, setShake] = useState(false);
  const keyInputRef = useRef<HTMLInputElement>(null);

  // Live nickname validation. Recomputed on every keystroke so the user gets
  // immediate, contextual feedback instead of a single opaque error on submit.
  // Whitespace is a hard block (it breaks @-mention tokenization); length is
  // advisory only (the server allows up to 40 and CJK names are supported).
  const nicknameIssue = useMemo(() => validateNickname(name), [name]);
  const nicknameErrorId = "nickname-format-error";
  const nicknameMessage =
    nicknameIssue == null
      ? null
      : nicknameIssue.kind === "whitespace"
        ? t("auth.field.nicknameWhitespace")
        : nicknameIssue.kind === "tooShort"
          ? t("auth.field.nicknameTooShort", { min: NICKNAME_RULE.min })
          : nicknameIssue.kind === "tooLong"
            ? t("auth.field.nicknameTooLong", { max: NICKNAME_RULE.max })
            : null;
  const nicknameBlocked = isBlockingIssue(nicknameIssue);

  const triggerShake = () => {
    setShake(false);
    // Two-step so re-triggering the same name still animates (class re-add).
    requestAnimationFrame(() => setShake(true));
  };

  const create = async () => {
    setError("");
    const issue = validateNickname(name);
    if (issue?.kind === "empty") {
      setError(t("auth.nameRequired"));
      triggerShake();
      return;
    }
    if (isBlockingIssue(issue)) {
      // Whitespace genuinely breaks mentions — block and explain, don't submit.
      setError(t("auth.field.nicknameWhitespace"));
      triggerShake();
      return;
    }
    setBusy(true);
    try {
      const { key, recoverCode } = await createParticipant(API_URL, name.trim());
      // Hand the freshly-minted key + recovery code to the app WITHOUT
      // persisting; the app shows the reveal and only saves once the user
      // acknowledges they've saved both.
      onCreated(key, recoverCode);
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
      // Keep the pasted value so the user can fix a typo instead of re-pasting
      // a long opaque key. Select-all on refocus: one keystroke replaces it,
      // arrow-keys edit it — both flows are cheap.
      requestAnimationFrame(() => {
        const el = keyInputRef.current;
        if (!el) return;
        el.focus();
        el.select();
      });
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
            {/* The shake wrapper jolts the whole field group (input + hint) when
                the user tries to submit a blocked nickname, drawing the eye to
                the explanation. motion-reduce isn't needed here: the global
                `* { animation-duration: 0.001ms }` wildcard in index.css
                collapses animate-shake under prefers-reduced-motion. */}
            <div className={shake ? "animate-shake space-y-2" : "space-y-2"}>
              <Label htmlFor="name">{t("auth.field.nickname")}</Label>
              <Input
                id="name"
                value={name}
                maxLength={40}
                placeholder={t("auth.field.nicknamePlaceholder")}
                autoComplete="off"
                aria-required="true"
                // Red border + ring as long as there's a blocking (whitespace)
                // issue OR a stale submit error. Advisory length issues stay
                // neutral so they read as a nudge, not a failure.
                // aria-invalid: boolean OR is intentional here — `nicknameBlocked` is
                // already a boolean and `false` is a legitimate value we want to treat
                // as falsy, unlike `??` which would not short-circuit on `false`.
                aria-invalid={nicknameBlocked || !!error}
                aria-describedby={
                  nicknameBlocked ?? nicknameMessage ? nicknameErrorId : "name-hint"
                }
                onChange={(e) => {
                  setName(e.target.value);
                  setError("");
                  setShake(false);
                }}
                onKeyDown={(e) => e.key === "Enter" && create()}
              />
              {/* Live validation message takes precedence over the static hint:
                 red for blocking issues (whitespace), amber for advisory length.
                 The hint is the fallback so an empty/valid field still explains
                 the @-mention connection. */}
              {nicknameBlocked || nicknameMessage ? (
                <p
                  id={nicknameErrorId}
                  role={nicknameBlocked ? "alert" : "status"}
                  className={
                    nicknameBlocked
                      ? "flex items-center gap-1.5 text-xs text-destructive"
                      : "flex items-center gap-1.5 text-xs text-human"
                  }
                >
                  {nicknameBlocked && <AlertTriangle className="h-3 w-3" aria-hidden />}
                  {nicknameMessage}
                </p>
              ) : (
                <p id="name-hint" className="text-xs text-muted-foreground">
                  {t("auth.field.nicknameHint")}
                </p>
              )}
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
                onChange={(e) => {
                  setPasteKey(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && paste()}
              />
            </div>
            <Button className="w-full" disabled={busy} onClick={paste}>
              {busy ? t("auth.enter.busy") : t("auth.enter")}
            </Button>
          </div>
        )}

        {/* Shared submit error (paste path: unrecognized key; create path:
            server collision / network). Icon + red so it can't be missed,
            unlike the previous plain muted line (P1-3). */}
        {error && mode === "paste" && (
          <p
            id="key-error"
            role="alert"
            className="flex items-center gap-1.5 text-sm text-destructive"
          >
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {error}
          </p>
        )}

        {/* Two equal-weight paths (FC2): create is the primary route, paste is a
            clearly delineated secondary button — not a single gray link that
            buries the alternative. Both directions use the same button treatment
            so switching either way feels symmetric. */}
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => {
            setError("");
            setMode(mode === "create" ? "paste" : "create");
          }}
        >
          {mode === "create" ? t("auth.switchToPaste") : t("auth.switchToCreate")}
        </Button>

        {/* Recover identity: a SECONDARY entry off the paste path only (PRD
            §8.2 — not a third main route). Hidden on the create path so it
            doesn't compete with onboarding; reachable once the user has
            explicitly chosen "I already have credentials" but realizes they
            have the recovery code, not the key. */}
        {mode === "paste" && (
          <button
            type="button"
            className="text-center text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
            onClick={() => setRecoverOpen(true)}
          >
            {t("auth.recover.entry")}
          </button>
        )}

        <RecoverDialog
          open={recoverOpen}
          onOpenChange={setRecoverOpen}
          onRecovered={(key, recoverCode) => {
            setRecoverOpen(false);
            // Hand the rotated pair to the app so it can reveal them before
            // persisting (defaults to onAuthed for callers that don't opt in).
            (onRecovered ?? ((k) => onAuthed(k)))(key, recoverCode);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
