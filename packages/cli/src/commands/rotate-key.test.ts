import { afterEach, beforeEach,describe, expect, it, vi } from "vitest";

import type { Participant } from "@club/shared";

import { type RotateKeyDeps, type RotateKeyResult, runRotateKey } from "./rotate-key.js";

const me: Participant = { id: "p_1", name: "alice", bio: "", createdAt: 0 };
const rotateResult: RotateKeyResult = { key: "new_key_456", recoverCode: "new_recover_xyz" };

function makeDeps(over: Partial<RotateKeyDeps> = {}): RotateKeyDeps {
  return {
    me: vi.fn().mockResolvedValue(me),
    rotateKey: vi.fn().mockResolvedValue(rotateResult),
    saveConfig: vi.fn(),
    ...over,
  };
}

describe("runRotateKey", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls rotateKey with the participant id and the current key as password", async () => {
    const deps = makeDeps();
    await runRotateKey({ currentKey: "old_key", server: "http://localhost:6200" }, deps);
    expect(deps.rotateKey).toHaveBeenCalledWith("p_1", "old_key");
  });

  it("saves the new key (keeping the server) into config", async () => {
    const deps = makeDeps();
    await runRotateKey({ currentKey: "old_key", server: "http://remote.server" }, deps);
    expect(deps.saveConfig).toHaveBeenCalledWith({
      server: "http://remote.server",
      key: "new_key_456",
    });
  });

  it("prints the rotation confirmation + the new recovery code with a save-it warning", async () => {
    const deps = makeDeps();
    await runRotateKey({ currentKey: "old_key", server: "http://x" }, deps);
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toContainEqual(["rotated key for alice (id=p_1)."]);
    expect(calls).toContainEqual(["new key saved to config."]);
    expect(calls).toContainEqual(["new recovery code (save it - the old one is now invalid):"]);
    expect(calls).toContainEqual(["  new_recover_xyz"]);
  });

  it("does not persist config when rotateKey throws", async () => {
    const deps = makeDeps({
      rotateKey: vi.fn().mockRejectedValue(new Error("401 bad password")),
    });
    await expect(
      runRotateKey({ currentKey: "wrong", server: "http://x" }, deps),
    ).rejects.toThrow("401 bad password");
    expect(deps.saveConfig).not.toHaveBeenCalled();
  });

  it("does not log success when rotateKey throws", async () => {
    const deps = makeDeps({
      rotateKey: vi.fn().mockRejectedValue(new Error("rejected")),
    });
    await expect(
      runRotateKey({ currentKey: "old_key", server: "http://x" }, deps),
    ).rejects.toThrow("rejected");
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(0);
  });
});
