import { describe, expect,it } from "vitest";

import { type ReadableLike,readStream } from "./stdin.js";

// A minimal hand-driven fake of a readable stream.
function fakeStream(
  opts: { isTTY?: boolean } = {},
): ReadableLike & { emit(event: "data" | "end" | "error", arg?: unknown): void } {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    isTTY: opts.isTTY,
    setEncoding() {},
    on(event, handler) {
      (handlers[event] ??= []).push(handler);
    },
    emit(event, arg) {
      for (const h of handlers[event] ?? []) h(arg);
    },
  };
}

describe("readStream", () => {
  it("concatenates chunks and resolves on 'end'", async () => {
    const s = fakeStream();
    const p = readStream(s);
    s.emit("data", "hel");
    s.emit("data", "lo");
    s.emit("end");
    expect(await p).toBe("hello");
  });

  it("resolves with '' when the stream ends with no data", async () => {
    const s = fakeStream();
    const p = readStream(s);
    s.emit("end");
    expect(await p).toBe("");
  });

  it("rejects when stdin is a TTY (no piped input) instead of hanging forever", async () => {
    const s = fakeStream({ isTTY: true });
    await expect(readStream(s)).rejects.toThrow(/piped input/i);
  });

  it("rejects on a stream 'error' instead of hanging forever", async () => {
    const s = fakeStream();
    const p = readStream(s);
    s.emit("error", new Error("EIO"));
    await expect(p).rejects.toThrow("EIO");
  });
});
