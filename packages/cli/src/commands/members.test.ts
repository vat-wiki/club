import { afterEach,describe, expect, it, vi } from "vitest";

import type { Participant } from "@club/shared";

import { type MembersDeps,runMembers } from "./members.js";

const alice: Participant = { id: "p_1", name: "alice", createdAt: 0 };
const bob: Participant = { id: "p_2", name: "bob", createdAt: 0 };

describe("runMembers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints each participant name in order", async () => {
    const deps: MembersDeps = { members: vi.fn().mockResolvedValue([alice, bob]) };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runMembers(deps);
    expect(deps.members).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith("alice");
    expect(log).toHaveBeenLastCalledWith("bob");
  });

  it("prints the empty-room footer when there are no members", async () => {
    const deps: MembersDeps = { members: vi.fn().mockResolvedValue([]) };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runMembers(deps);
    expect(deps.members).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("(no members)");
  });

  it("does not print the empty-room footer when there is at least one member", async () => {
    const deps: MembersDeps = { members: vi.fn().mockResolvedValue([alice]) };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runMembers(deps);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("alice");
    expect(log).not.toHaveBeenCalledWith("(no members)");
  });

  it("propagates an SDK error through to the caller", async () => {
    const deps: MembersDeps = {
      members: vi.fn().mockRejectedValue(new Error("network unreachable")),
    };
    await expect(runMembers(deps)).rejects.toThrow("network unreachable");
  });
});
