import { useT } from "@/lib/i18n";
import { Check, Copy, Download, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Non-blocking toast shown after successful account creation.
 * Displays the backup code with copy/download buttons and auto-dismisses.
 */
export function AccountCreatedToast({
  recoverCode,
  onDismiss,
}: {
  recoverCode: string;
  onDismiss: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss after 10 seconds
  useEffect(() => {
    timerRef.current = setTimeout(() => {
      onDismiss();
    }, 10000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [onDismiss]);

  // Pause auto-dismiss on hover
  const handleMouseEnter = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  const handleMouseLeave = () => {
    timerRef.current = setTimeout(() => {
      onDismiss();
    }, 10000);
  };

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(recoverCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [recoverCode]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([`Club Backup Code: ${recoverCode}`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "club-backup-code.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [recoverCode]);

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="fixed top-4 right-4 z-50 w-[min(92vw,22rem)] animate-in slide-in-from-top-2 fade-in duration-300 sm:right-6"
    >
      <div className="rounded-lg border border-border/60 bg-card px-4 py-3 shadow-lg">
        <div className="flex items-start gap-3">
          {/* Content */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">
              {t("accountCreated.title")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("accountCreated.message")}
            </p>

            {/* Backup code display */}
            <div className="mt-2 rounded bg-muted/40 px-2 py-1">
              <code className="text-xs font-mono text-foreground break-all">
                {recoverCode}
              </code>
            </div>

            {/* Action buttons */}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors hover:bg-accent"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3" aria-hidden />
                    {t("accountCreated.copied")}
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" aria-hidden />
                    {t("accountCreated.copy")}
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors hover:bg-accent"
              >
                <Download className="h-3 w-3" aria-hidden />
                {t("accountCreated.download")}
              </button>
            </div>
          </div>

          {/* Close button */}
          <button
            type="button"
            onClick={onDismiss}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={t("dialog.close")}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
