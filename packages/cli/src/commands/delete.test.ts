import { describe, it, expect, vi, afterEach } from "vitest";
import { runDelete, type DeleteDeps } from "./delete.js";

describe("runDelete", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls deleteMessage with the trimmed id and logs the original", async () => {
    const deps: DeleteDeps = {
      deleteMessage: vi.fn().mockResolvedValue(undefined),
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runDelete({ id: "  msg_42  " }, deps);
    expect(deps.deleteMessage).toHaveBeenCalledWith("msg_42");
    expect(log).toHaveBeenCalledWith("deleted   msg_42  ");
  });

  it("keeps a plain id unaltered (no extra trim noise)", async () => {
    const deps: DeleteDeps = {
      deleteMessage: vi.fn().mockResolvedValue(undefined),
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runDelete({ id: "msg_1" }, deps);
    expect(deps.deleteMessage).toHaveBeenCalledWith("msg_1");
    expect(log).toHaveBeenCalledWith("deleted msg_1");
  });

  it("propagates an SDK error through to the caller", async () => {
    const deps: DeleteDeps = {
      deleteMessage: vi.fn().mockRejectedValue(new Error("403 not the author")),
    };
    await expect(runDelete({ id: "msg_99" }, deps)).rejects.toThrow(
      "403 not the author",
    );
  });

  it("does not log success when the server rejects the delete", async () => {
    const deps: DeleteDeps = {
      deleteMessage: vi.fn().mockRejectedValue(new Error("deleted")),
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(runDelete({ id: "msg_1" }, deps)).rejects.toThrow();
    expect(log).not.toHaveBeenCalled();
  });
});
