import { afterEach,describe, expect, it, vi } from "vitest";

import type { Message } from "@club/shared";

import { type EditDeps, runEdit } from "./edit.js";

const updatedMessage: Message = {
  id: "msg_42",
  participantId: "p_1",
  authorName: "alice",
  content: "edited body",
  createdAt: 1000,
  channel: "general",
  editedAt: 2000,
};

function makeDeps(over: Partial<EditDeps> = {}): EditDeps {
  return {
    editMessage: vi.fn().mockResolvedValue(updatedMessage),
    formatMessage: (m) => `[fmt] ${m.id}: ${m.content}`,
    ...over,
  };
}

describe("runEdit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls editMessage with the trimmed id + content and prints the formatted row", async () => {
    const deps = makeDeps();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runEdit({ id: "  msg_42  ", content: "edited body" }, deps);
    expect(deps.editMessage).toHaveBeenCalledWith("msg_42", "edited body");
    expect(log).toHaveBeenCalledWith("[fmt] msg_42: edited body");
  });

  it("keeps a plain id unaltered (no extra trim noise)", async () => {
    const deps = makeDeps();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runEdit({ id: "msg_1", content: "hi" }, deps);
    expect(deps.editMessage).toHaveBeenCalledWith("msg_1", "hi");
    expect(log).toHaveBeenCalledWith("[fmt] msg_42: edited body");
  });

  it("passes content verbatim (no trimming inside runEdit)", async () => {
    const deps = makeDeps();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runEdit({ id: "msg_1", content: "  keep spaces  " }, deps);
    // Trimming is the action's job; runEdit forwards exactly what it was given
    // so the contract with the action is unambiguous.
    expect(deps.editMessage).toHaveBeenCalledWith("msg_1", "  keep spaces  ");
  });

  it("propagates a 404 (not yours / already recalled) through to the caller", async () => {
    const deps = makeDeps({
      editMessage: vi.fn().mockRejectedValue(new Error("404 not the author")),
    });
    await expect(
      runEdit({ id: "msg_99", content: "x" }, deps),
    ).rejects.toThrow("404 not the author");
  });

  it("does not log success when the server rejects the edit", async () => {
    const deps = makeDeps({
      editMessage: vi.fn().mockRejectedValue(new Error("404 already recalled")),
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(runEdit({ id: "msg_1", content: "x" }, deps)).rejects.toThrow();
    expect(log).not.toHaveBeenCalled();
  });
});
