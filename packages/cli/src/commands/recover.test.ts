import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  runRecover,
  type RecoverDeps,
  type RecoverResult,
} from "./recover.js";

const fixtureResult: RecoverResult = {
  key: "new_key_123",
  participant: { name: "alice", id: "p_1" },
  recoverCode: "new_recovery_abc",
};

function makeDeps(over: Partial<RecoverDeps> = {}): RecoverDeps {
  return {
    recoverParticipant: vi.fn().mockResolvedValue(fixtureResult),
    saveConfig: vi.fn(),
    ...over,
  };
}

describe("runRecover", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls recoverParticipant with trimmed name and the code", async () => {
    const deps = makeDeps();
    await runRecover(
      { name: "  alice  ", recoverCode: "old_code", server: "http://localhost:6200" },
      deps,
    );
    expect(deps.recoverParticipant).toHaveBeenCalledWith({
      name: "alice",
      recoverCode: "old_code",
    });
  });

  it("saves the new key and server into config", async () => {
    const deps = makeDeps();
    await runRecover(
      { name: "bob", recoverCode: "code", server: "http://remote.server" },
      deps,
    );
    expect(deps.saveConfig).toHaveBeenCalledWith({
      server: "http://remote.server",
      key: "new_key_123",
    });
  });

  it("prints the recovered identity and the new recovery code", async () => {
    const deps = makeDeps();
    await runRecover(
      { name: "bob", recoverCode: "code", server: "http://x" },
      deps,
    );
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toContainEqual(["recovered. you are now alice (id=p_1)."]);
    expect(calls).toContainEqual(["new key saved to config."]);
    expect(calls).toContainEqual(["new recovery code (save it — the old one is now invalid):"]);
    expect(calls).toContainEqual(["  new_recovery_abc"]);
    expect(calls).toContainEqual(["try: club whoami"]);
  });

  it("does not persist config when recoverParticipant throws", async () => {
    const deps = makeDeps({
      recoverParticipant: vi.fn().mockRejectedValue(new Error("invalid code")),
    });
    await expect(
      runRecover({ name: "bob", recoverCode: "bad", server: "http://x" }, deps),
    ).rejects.toThrow("invalid code");
    expect(deps.saveConfig).not.toHaveBeenCalled();
  });

  it("does not log success when recoverParticipant throws", async () => {
    const deps = makeDeps({
      recoverParticipant: vi.fn().mockRejectedValue(new Error("rejected")),
    });
    await expect(
      runRecover({ name: "bob", recoverCode: "bad", server: "http://x" }, deps),
    ).rejects.toThrow("rejected");
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(0);
  });
});
