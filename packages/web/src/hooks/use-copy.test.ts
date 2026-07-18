import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCopy } from "./use-copy.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setupClipboard(supported = true) {
  if (supported) {
    const mockWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: mockWrite },
      configurable: true,
    });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    return { writeText: mockWrite };
  } else {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
    return { writeText: null };
  }
}

describe("useCopy", () => {
  it("starts in idle state", () => {
    setupClipboard();
    const { result } = renderHook(() => useCopy());
    expect(result.current.state).toBe("idle");
  });

  it("transitions to copied on successful clipboard write", async () => {
    setupClipboard();
    const { result } = renderHook(() => useCopy());

    await act(async () => {
      await result.current.copy("hello world");
    });
    expect(result.current.state).toBe("copied");
  });

  it("transitions to failed when clipboard write throws", async () => {
    const mockWrite = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: mockWrite },
      configurable: true,
    });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });

    const { result } = renderHook(() => useCopy());
    await act(async () => {
      await result.current.copy("sensitive");
    });
    expect(result.current.state).toBe("failed");
  });

  it("falls back to execCommand in non-secure contexts", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
    const mockExec = vi.fn(() => true);
    document.execCommand = mockExec;

    const { result } = renderHook(() => useCopy());
    await act(async () => {
      await result.current.copy("fallback text");
    });
    expect(result.current.state).toBe("copied");
    expect(mockExec).toHaveBeenCalledWith("copy");
  });

  it("auto-resets to idle after the timeout", async () => {
    setupClipboard();
    vi.useFakeTimers();
    const { result } = renderHook(() => useCopy(500));

    await act(async () => {
      await result.current.copy("text");
    });
    expect(result.current.state).toBe("copied");

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.state).toBe("idle");

    vi.useRealTimers();
  });

  it("manual reset clears state and cancels pending auto-reset", async () => {
    setupClipboard();
    vi.useFakeTimers();
    const { result } = renderHook(() => useCopy(500));

    await act(async () => {
      await result.current.copy("text");
    });
    expect(result.current.state).toBe("copied");

    await act(async () => {
      result.current.reset();
    });
    expect(result.current.state).toBe("idle");

    // Advance time — should not re-set to anything (timer was cleared).
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.state).toBe("idle");

    vi.useRealTimers();
  });

  it("copying again while in 'copied' state resets the timer", async () => {
    setupClipboard();
    vi.useFakeTimers();
    const { result } = renderHook(() => useCopy(500));

    await act(async () => {
      await result.current.copy("first");
    });
    expect(result.current.state).toBe("copied");

    // Advance time partway — still copied
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.state).toBe("copied");

    // Copy again — timer should reset
    await act(async () => {
      await result.current.copy("second");
    });
    expect(result.current.state).toBe("copied");

    // Advance time partway through the new timer — still copied
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.state).toBe("copied");

    // Advance past the 500ms threshold → idle
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.state).toBe("idle");

    vi.useRealTimers();
  });

  it("clears the timer on unmount", async () => {
    setupClipboard();
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useCopy(500));

    await act(async () => {
      await result.current.copy("text");
    });
    expect(result.current.state).toBe("copied");

    unmount();

    // No error should be thrown when the timer fires after unmount
    vi.advanceTimersByTime(500);

    vi.useRealTimers();
  });
});
