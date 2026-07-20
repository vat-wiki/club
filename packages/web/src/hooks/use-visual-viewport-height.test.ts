import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useVisualViewportHeight } from "./use-visual-viewport-height";

// jsdom has no window.visualViewport. The hook must guard against its absence
// (no-op, fall back to 100dvh). These tests install a minimal mock to verify
// the wiring: --app-height is written, resize re-writes it, and the onShrink
// callback fires only when the height decreases.

type VVLike = {
  height: number;
  width: number;
  offsetTop: number;
  offsetLeft: number;
  scale: number;
  onresize: ((this: VisualViewport, ev: Event) => void) | null;
  onscroll: ((this: VisualViewport, ev: Event) => void) | null;
  addEventListener: (
    type: string,
    listener: (ev: Event) => void,
  ) => void;
  removeEventListener: (type: string, listener: (ev: Event) => void) => void;
};

function installVisualViewport(initialHeight: number): VVLike & { emit: (h: number) => void } {
  const listeners = new Map<string, Set<(ev: Event) => void>>();
  const vv = {
    height: initialHeight,
    width: 390,
    offsetTop: 0,
    offsetLeft: 0,
    scale: 1,
    onresize: null,
    onscroll: null,
    addEventListener: (type: string, listener: (ev: Event) => void) => {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(listener);
    },
    removeEventListener: (type: string, listener: (ev: Event) => void) => {
      listeners.get(type)?.delete(listener);
    },
  };
  const emit = (h: number) => {
    vv.height = h;
    for (const l of listeners.get("resize") ?? []) l(new Event("resize"));
  };
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: vv,
  });
  return { ...vv, emit };
}

describe("useVisualViewportHeight", () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty("--app-height");
  });

  afterEach(() => {
    // Remove the mock so later suites see a clean window.
    Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
  });

  it("is a no-op when window.visualViewport is absent (jsdom / desktop fallback)", () => {
    // Ensure absence.
    Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
    const { unmount } = renderHook(() => useVisualViewportHeight());
    // No --app-height written → #root falls back to 100dvh.
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("");
    // And it must not throw on mount/unmount.
    expect(() => unmount()).not.toThrow();
  });

  it("writes --app-height from visualViewport.height on mount", () => {
    installVisualViewport(844);
    renderHook(() => useVisualViewportHeight());
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("844px");
  });

  it("re-writes --app-height when the viewport resizes", () => {
    const vv = installVisualViewport(844);
    renderHook(() => useVisualViewportHeight());
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("844px");

    // Simulate the iOS soft keyboard opening: visual viewport shrinks.
    act(() => vv.emit(420));
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("420px");
  });

  it("fires onShrink only when the height decreases", () => {
    const vv = installVisualViewport(844);
    const onShrink = vi.fn();
    renderHook(() => useVisualViewportHeight(onShrink));

    // Mount does not count as a shrink (prev initialized to current height).
    expect(onShrink).not.toHaveBeenCalled();

    act(() => vv.emit(420)); // shrink → fire
    expect(onShrink).toHaveBeenCalledTimes(1);

    act(() => vv.emit(700)); // grow → do not fire
    expect(onShrink).toHaveBeenCalledTimes(1);

    act(() => vv.emit(300)); // shrink again → fire
    expect(onShrink).toHaveBeenCalledTimes(2);
  });

  it("uses the latest onShrink without re-subscribing", () => {
    const vv = installVisualViewport(844);
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useVisualViewportHeight(cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });

    act(() => vv.emit(400));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("removes its listeners on unmount", () => {
    const vv = installVisualViewport(844);
    const { unmount } = renderHook(() => useVisualViewportHeight());
    unmount();

    // After unmount, a resize must not touch --app-height.
    act(() => vv.emit(200));
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("844px");
  });
});
