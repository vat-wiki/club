import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type BootStatus = "loading" | "error";

// First-load gate shown while validating a stored key against /me, and the
// error state when that validation fails repeatedly. Two important properties:
//
//  1. The stored key is NEVER silently wiped on a transient /me failure. The
//     old behavior (clearConn + reopen AuthDialog) dumped the user back to
//     onboarding with no message and, on a server hiccup, cost them their
//     credential. We instead keep the key and offer retry.
//  2. Bounded auto-retry with exponential backoff, plus an `online` event
//     listener so recovery is self-healing once the network returns — the user
//     doesn't have to babysit a manual retry button.
//
// The "live stream dropped" case (after successfully entering the room) is a
// different concern handled by useMessageStream + the message-list banner; this
// component only owns the *initial* connect.

const MAX_AUTO_ATTEMPTS = 3;
// Exponential backoff: 1s, 2s, 4s. After MAX_AUTO_ATTEMPTS we stop auto-retrying
// and surface the manual retry/reload controls — but we keep listening for the
// `online` event so a regained connection still self-heals.
const BACKOFF_MS = [1000, 2000, 4000];

export function BootScreen({
  status,
  /** Bump to force a manual retry from the parent (key change → effect re-run). */
  retryNonce,
  onRetry,
}: {
  status: BootStatus;
  retryNonce: number;
  onRetry: () => void;
}) {
  const t = useT();
  // Tracks auto-retry attempts within the current failure cycle; resets when the
  // parent hands us a fresh retryNonce (a manual retry) or when we recover.
  const [attempt, setAttempt] = useState(0);
  // True briefly when an `online` event kicks off a retry, so we can show
  // "back online — reconnecting" instead of a generic retrying label.
  const [onlineTriggered, setOnlineTriggered] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) clearTimeout(id);
    timersRef.current = [];
  }, []);

  // Drive auto-retry with exponential backoff while in the error state and under
  // the attempt cap. Each attempt calls the parent's onRetry (which re-runs the
  // boot validation); if it fails again the parent flips status back to "error"
  // and this effect schedules the next attempt.
  useEffect(() => {
    if (status !== "error") {
      setAttempt(0);
      setOnlineTriggered(false);
      return;
    }
    if (attempt >= MAX_AUTO_ATTEMPTS) return;
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    const id = setTimeout(() => {
      onRetry();
      setAttempt((a) => a + 1);
    }, delay);
    timersRef.current.push(id);
    return () => {
      clearTimeout(id);
    };
  }, [status, attempt, onRetry]);

  // A manual retry (parent bumped retryNonce) resets the auto-retry counter so
  // the user gets a fresh backoff sequence.
  useEffect(() => {
    setAttempt(0);
    setOnlineTriggered(false);
  }, [retryNonce]);

  // Self-heal on `online`: when the browser regains connectivity, immediately
  // fire a retry (no waiting for the backoff timer) and label it accordingly.
  useEffect(() => {
    if (status !== "error") return;
    const onOnline = () => {
      setOnlineTriggered(true);
      onRetry();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [status, onRetry]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const autoRetrying = status === "error" && attempt < MAX_AUTO_ATTEMPTS;
  const exhausted = status === "error" && attempt >= MAX_AUTO_ATTEMPTS;

  if (status === "loading" && !onlineTriggered) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground/85"
        >
          <span className="h-2 w-2 rounded-full bg-agent animate-agent-pulse" aria-hidden />
          {t("boot.connecting")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
      <div
        role="alert"
        aria-live="assertive"
        className="flex w-full max-w-sm flex-col items-center gap-4 rounded-lg border border-destructive/30 border-l-2 border-l-destructive bg-destructive/10 p-6 text-center"
      >
        <AlertTriangle className="h-6 w-6 animate-pulse text-destructive" aria-hidden />
        <div className="space-y-1.5">
          <p className="font-display text-base font-semibold text-destructive">
            {t("boot.error.title")}
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("boot.error.desc")}
          </p>
        </div>

        {/* Live status line: which attempt / online-triggered / exhausted.
            aria-live so SR users hear the state change without scanning. */}
        <p
          role="status"
          aria-live="polite"
          className="flex min-h-[1.25rem] items-center gap-1.5 font-mono text-[11px] text-muted-foreground"
        >
          {autoRetrying && !onlineTriggered && (
            <>
              <RotateCw className={cn("h-3 w-3", exhausted ? "" : "animate-spin")} aria-hidden />
              {t("boot.error.retrying", { n: attempt + 1 })}
            </>
          )}
          {onlineTriggered && (
            <>
              <RotateCw className="h-3 w-3 animate-spin" aria-hidden />
              {t("boot.error.online")}
            </>
          )}
          {exhausted && !onlineTriggered && <span>&nbsp;</span>}
        </p>

        <div className="flex w-full flex-col gap-2">
          <Button
            variant="outline"
            className="w-full gap-2"
            // A manual retry hands control back to the user; we re-arm auto-retry
            // by bumping the parent nonce (which resets `attempt`).
            onClick={onRetry}
            aria-label={t("boot.error.retry.aria")}
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            {t("boot.error.retry")}
          </Button>
          <Button
            variant="ghost"
            className="w-full gap-2 text-muted-foreground"
            onClick={() => window.location.reload()}
          >
            <RotateCw className="h-3.5 w-3.5" aria-hidden />
            {t("boot.error.reload")}
          </Button>
        </div>
      </div>
    </div>
  );
}
