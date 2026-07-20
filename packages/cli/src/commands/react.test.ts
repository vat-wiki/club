import { describe, it, expect, vi } from "vitest";
import { sanitizeEmoji, runReact, type ReactDeps } from "./react.js";

describe("sanitizeEmoji", () => {
  it("strips NUL character", () => {
    expect(sanitizeEmoji("\x00👍")).toBe("👍");
  });

  it("strips CRLF characters", () => {
    expect(sanitizeEmoji("👍\r\n")).toBe("👍");
  });

  it("strips DEL character", () => {
    expect(sanitizeEmoji("👍\x7f")).toBe("👍");
  });

  it("strips mixed control characters", () => {
    expect(sanitizeEmoji("\x01👍\x1f")).toBe("👍");
  });

  it("preserves normal emoji", () => {
    expect(sanitizeEmoji("🎉🎉")).toBe("🎉🎉");
  });

  it("preserves whitespace", () => {
    expect(sanitizeEmoji(" 🎉 ")).toBe(" 🎉 ");
  });
});

describe("runReact", () => {
  function makeDeps(): ReactDeps {
    return {
      toggleReaction: vi.fn().mockResolvedValue([{ emoji: "👍", count: 1 }]),
    };
  }

  it("strips control characters before sending to server", async () => {
    const deps = makeDeps();
    await runReact({ id: "msg-1", emoji: "👍\x00" }, deps);
    expect(deps.toggleReaction).toHaveBeenCalledWith("msg-1", "👍");
  });

  it("trims the emoji", async () => {
    const deps = makeDeps();
    await runReact({ id: "msg-1", emoji: "  👍  " }, deps);
    expect(deps.toggleReaction).toHaveBeenCalledWith("msg-1", "👍");
  });
});
