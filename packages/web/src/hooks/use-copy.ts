import { useCallback, useEffect, useRef, useState } from "react";

// Copy text to the clipboard with a graceful fallback for non-secure contexts
// (e.g. http on a non-localhost origin) or older browsers where
// navigator.clipboard is unavailable. Returns a state machine the UI can drive
// an aria-live announcement off of: "idle" → "copying" → "copied" | "failed".
//
// We deliberately avoid execCommand for the *primary* path (it's deprecated
// and silently no-ops in some browsers), but keep it as a last resort so a
// clipboard-less environment still gets the text onto the clipboard instead of
// a hard failure.

export type CopyState = "idle" | "copying" | "copied" | "failed";

export function useCopy(resetAfterMs = 2500) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancel any pending "auto reset" timer on unmount so we never setState on
  // an unmounted component (and never fire a stale reset after a re-copy).
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      setState("copying");
      // Reset transient feedback after a beat so a stale "copied"/"failed"
      // doesn't linger across unrelated interactions.
      if (timer.current) clearTimeout(timer.current);

      const ok = await writeToClipboard(text);
      setState(ok ? "copied" : "failed");

      if (ok) {
        timer.current = setTimeout(() => setState("idle"), resetAfterMs);
      }
      return ok;
    },
    [resetAfterMs],
  );

  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setState("idle");
  }, []);

  return { state, copy, reset };
}

async function writeToClipboard(text: string): Promise<boolean> {
  // Preferred path: async Clipboard API. Available on https/localhost.
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path — clipboard API can reject for
      // permission reasons even when present.
    }
  }
  // Legacy fallback: a hidden textarea + execCommand. Still works in many
  // non-secure contexts where the async API is unavailable.
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    // Move it off-screen rather than hide it; some browsers refuse to copy
    // from a display:none element.
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
