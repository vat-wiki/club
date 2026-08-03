import { afterEach, describe, expect, it, vi } from "vitest";

import type { Participant } from "@club/shared";

import { formatMemberLine, type MembersDeps, runMembers } from "./members.js";

const alice: Participant = { id: "p_1", name: "alice", bio: "运维", createdAt: 0 };
const bob: Participant = { id: "p_2", name: "bob", bio: "", createdAt: 0 };

describe("formatMemberLine", () => {
  it("appends the bio after a bio: marker when set", () => {
    expect(formatMemberLine(alice)).toBe("alice  bio: 运维");
  });

  it("prints only the name when the bio is unset", () => {
    expect(formatMemberLine(bob)).toBe("bob");
  });
});

describe("runMembers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints each participant with bio (when set) in order", async () => {
    const deps: MembersDeps = { members: vi.fn().mockResolvedValue([alice, bob]) };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runMembers({}, deps);
    expect(deps.members).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith("alice  bio: 运维");
    expect(log).toHaveBeenLastCalledWith("bob");
  });

  it("prints the empty-channel footer when there are no members", async () => {
    const deps: MembersDeps = { members: vi.fn().mockResolvedValue([]) };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runMembers({}, deps);
    expect(deps.members).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("(no members)");
  });

  it("does not print the empty-channel footer when there is at least one member", async () => {
    const deps: MembersDeps = { members: vi.fn().mockResolvedValue([alice]) };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runMembers({}, deps);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("alice  bio: 运维");
    expect(log).not.toHaveBeenCalledWith("(no members)");
  });

  it("propagates an SDK error through to the caller", async () => {
    const deps: MembersDeps = {
      members: vi.fn().mockRejectedValue(new Error("network unreachable")),
    };
    await expect(runMembers({}, deps)).rejects.toThrow("network unreachable");
  });

  it("--json: outputs a JSON array with participant ids and skips human formatting", async () => {
    const deps: MembersDeps = { members: vi.fn().mockResolvedValue([alice, bob]) };
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runMembers({ json: true }, deps);
    expect(log).not.toHaveBeenCalled();
    const parsed = JSON.parse((write.mock.calls[0][0] as string).trim());
    expect(parsed.map((p: { id: string }) => p.id)).toEqual(["p_1", "p_2"]);
  });
});
