import { useEffect, useRef } from "react";

/**
 * Keep `--app-height` in sync with the visual viewport so `#root` (whose height
 * is `var(--app-height, 100dvh)`) actually shrinks when a mobile soft keyboard
 * opens. On iOS Safari the keyboard shrinks `visualViewport` but NOT the layout
 * viewport, so `100dvh` alone leaves `#root` at full height and the flex-none
 * composer pinned below the visible area. Driving `#root` from visualViewport
 * makes the composer hug the top of the keyboard; combined with the root chain's
 * `overflow:hidden` the page can no longer be dragged out of view.
 *
 * `onShrink` (optional) is invoked when the visible height has decreased since
 * the last update — e.g. the keyboard just opened. Callers use it to re-pin a
 * scrollable region (the message list) so its bottom isn't hidden behind the
 * keyboard. Not fired on growth (keyboard closing) or on desktop, where
 * `visualViewport.height === window.innerHeight` stays constant.
 *
 * Desktop / older browsers: `visualViewport` is absent -> the effect is a no-op
 * and `#root` falls back to `100dvh`. Where present, `visualViewport.height`
 * equals `window.innerHeight` until something (keyboard, pinch-zoom) changes
 * it, so this never alters desktop layout.
 *
 * @param onShrink - Optional callback fired on every shrink of the visible height.
 *
 * @example
 * function MessageList() {
 *   const bottomRef = useRef<HTMLDivElement>(null);
 *   useVisualViewportHeight(() => bottomRef.current?.scrollIntoView());
 *   // ...
 * }
 */
export function useVisualViewportHeight(onShrink?: () => void) {
  // Keep the latest callback in a ref so the effect (mounted once) always calls
  // the current closure without re-subscribing on every render.
  const onShrinkRef = useRef(onShrink);
  onShrinkRef.current = onShrink;

  useEffect(() => {
    const vv = window.visualViewport;
    // jsdom has no visualViewport; desktop/old browsers may lack it too. No-op
    // and let #root fall back to 100dvh.
    if (!vv) return;

    let prev = vv.height;
    const apply = () => {
      const h = vv.height;
      document.documentElement.style.setProperty("--app-height", `${h}px`);
      // Only react to shrinkage (keyboard opening). Growing back is handled by
      // the restored layout itself.
      if (h < prev) onShrinkRef.current?.();
      prev = h;
    };
    apply();
    // `resize` fires on most platforms; iOS also fires `scroll` when the
    // keyboard pushes the visual viewport up, so listen to both.
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
    };
  }, []);
}
