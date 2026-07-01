import { useEffect } from "react";
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
import { useT } from "@/lib/i18n";

// Shown right after a brand-new identity is minted. The app has NOT persisted
// the key yet — it only does so once the user clicks "I've saved it". This is
// the deliberate friction point: the login key is the entry credential and the
// recovery code is the only way back if the key is ever lost, so we show BOTH
// and force the user to record them before entering the room (PRD §7.1 AC1).

const KEY_LIVE = "key-reveal-key-status";
const RECOVER_LIVE = "key-reveal-recover-status";

function CopyField({
  focusMarker,
  labelId,
  label,
  value,
  copyLabel,
  copiedLabel,
  failedLabel,
  announcedLabel,
  liveId,
  focusOnOpen,
}: {
  // A data-* attribute object applied to the copy button so the parent can
  // focus it on open (and tests can target it). Spelled out as a plain object
  // rather than computed `data-{id}` because JSX doesn't allow dynamic attr
  // names; `{ "data-key-copy-btn": true }` renders as data-key-copy-btn.
  focusMarker: Record<string, true>;
  labelId: string;
  label: string;
  value: string;
  copyLabel: string;
  copiedLabel: string;
  failedLabel: string;
  announcedLabel: string;
  liveId: string;
  focusOnOpen?: boolean;
}) {
  const { state, copy } = useCopy();
  const copied = state === "copied";
  const failed = state === "failed";

  // Focus the first copy field's button on open so keyboard users land on the
  // critical first action (Radix focuses content by default; we promote it).
  useEffect(() => {
    if (!focusOnOpen) return;
    const markerKey = Object.keys(focusMarker)[0] ?? "";
    const id2 = requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(`[${markerKey}]`)
        ?.focus();
    });
    return () => cancelAnimationFrame(id2);
  }, [focusOnOpen, focusMarker]);

  return (
    <div className="space-y-1.5">
      <p id={labelId} className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {/* Break-all so the long string wraps instead of overflowing on narrow
          viewports; font-mono so it's unambiguous. */}
      <output
        aria-labelledby={labelId}
        className="block w-full break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-sm text-foreground"
      >
        {value}
      </output>
      <Button
        {...focusMarker}
        variant={copied ? "outline" : "secondary"}
        className="w-full gap-2"
        onClick={() => copy(value)}
        aria-describedby={liveId}
      >
        {copied ? (
          <>
            <Check className="h-4 w-4" aria-hidden />
            {copiedLabel}
          </>
        ) : (
          <>
            <Copy className="h-4 w-4" aria-hidden />
            {copyLabel}
          </>
        )}
      </Button>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {failedLabel}
        </p>
      )}
      <p id={liveId} role="status" aria-live="polite" className="sr-only">
        {copied ? announcedLabel : ""}
      </p>
    </div>
  );
}

export function KeyRevealDialog({
  open,
  key_,
  recoverCode,
  onSaved,
  // When true the dialog reads as a *recovery* success — "these are your NEW
  // rotated credentials, the old ones are dead" — instead of the first-mint
  // wording. Same copy fields/layout; only the title/desc/ack button change.
  recovered = false,
}: {
  open: boolean;
  key_: string;
  recoverCode: string;
  // Called once the user acknowledges they've saved both. The app then
  // persists the key and enters the room.
  onSaved: () => void;
  recovered?: boolean;
}) {
  const t = useT();
  const titleKey = recovered ? "keyReveal.recovered.title" : "keyReveal.title";
  const descKey = recovered ? "keyReveal.recovered.desc" : "keyReveal.desc";
  const savedKey = recovered ? "keyReveal.recovered.saved" : "keyReveal.saved";

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-[460px] gap-5"
        // Not dismissible until acknowledged — Esc / outside click would
        // silently drop the only chance to record the credentials.
        showClose={false}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-human" aria-hidden />
            {t(titleKey)}
          </DialogTitle>
          <DialogDescription>{t(descKey)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <CopyField
            focusMarker={{ "data-key-copy-btn": true }}
            labelId="key-reveal-label"
            label={t("keyReveal.label")}
            value={key_}
            copyLabel={t("keyReveal.copy")}
            copiedLabel={t("keyReveal.copied")}
            failedLabel={t("keyReveal.copyFailed")}
            announcedLabel={t("keyReveal.copyAnnounced")}
            liveId={KEY_LIVE}
            focusOnOpen
          />
          {/* One-line note on the key shape so users don't second-guess the
              format (prefix + base64url random token; regenerated each mint). */}
          <p className="-mt-1 text-xs text-muted-foreground">
            {t("keyReveal.formatHint")}
          </p>

          <CopyField
            focusMarker={{ "data-recover-copy-btn": true }}
            labelId="key-reveal-recover-label"
            label={t("keyReveal.recoverLabel")}
            value={recoverCode}
            copyLabel={t("keyReveal.copyRecover")}
            copiedLabel={t("keyReveal.copied")}
            failedLabel={t("keyReveal.copyFailed")}
            announcedLabel={t("keyReveal.copyRecoverAnnounced")}
            liveId={RECOVER_LIVE}
          />

          {/* The first-mint flow reminds the user what the recovery code is for.
              On recovery-success the desc already spells out rotation, so the
              redundant hint is hidden to keep the dialog tight. */}
          {!recovered && (
            <p className="text-xs text-muted-foreground">
              {t("keyReveal.recoverHint")}
            </p>
          )}
        </div>

        <Button className="w-full" onClick={onSaved}>
          {t(savedKey)}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
