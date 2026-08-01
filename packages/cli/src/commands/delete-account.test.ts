import { afterEach, beforeEach,describe, expect, it, vi } from "vitest";

import type { Participant } from "@club/shared";

import { type DeleteAccountDeps, runDeleteAccount } from "./delete-account.js";

const me: Participant = { id: "p_1", name: "alice", bio: "", createdAt: 0 };

function makeDeps(over: Partial<DeleteAccountDeps> = {}): DeleteAccountDeps {
  return {
    me: vi.fn().mockResolvedValue(me),
    deleteAccount: vi.fn().mockResolvedValue(undefined),
    clearConfig: vi.fn(),
    ...over,
  };
}

describe("runDeleteAccount", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses without --yes (irreversible guard) and calls nothing", async () => {
    const deps = makeDeps();
    await expect(
      runDeleteAccount(
        { recoverCode: "code", currentKey: "key", yes: false },
        deps,
      ),
    ).rejects.toThrow(/--yes/);
    expect(deps.me).not.toHaveBeenCalled();
    expect(deps.deleteAccount).not.toHaveBeenCalled();
    expect(deps.clearConfig).not.toHaveBeenCalled();
  });

  it("calls deleteAccount with the participant id, current key, and recovery code", async () => {
    const deps = makeDeps();
    await runDeleteAccount(
      { recoverCode: "recover_abc", currentKey: "current_key", yes: true },
      deps,
    );
    expect(deps.deleteAccount).toHaveBeenCalledWith("p_1", {
      password: "current_key",
      recoverCode: "recover_abc",
    });
  });

  it("clears the config file after a successful self-delete (logs out)", async () => {
    const deps = makeDeps();
    await runDeleteAccount(
      { recoverCode: "code", currentKey: "key", yes: true },
      deps,
    );
    expect(deps.clearConfig).toHaveBeenCalledTimes(1);
  });

  it("prints a confirmation naming the deleted identity", async () => {
    const deps = makeDeps();
    await runDeleteAccount(
      { recoverCode: "code", currentKey: "key", yes: true },
      deps,
    );
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toContainEqual([
      "deleted account alice (id=p_1). config cleared - you are logged out.",
    ]);
  });

  it("does not clear config when deleteAccount throws (account still exists)", async () => {
    const deps = makeDeps({
      deleteAccount: vi.fn().mockRejectedValue(new Error("403 bad recovery code")),
    });
    await expect(
      runDeleteAccount(
        { recoverCode: "bad", currentKey: "key", yes: true },
        deps,
      ),
    ).rejects.toThrow("403 bad recovery code");
    expect(deps.clearConfig).not.toHaveBeenCalled();
  });
});
