import { describe, it, expect, vi, afterEach } from "vitest";
import type { Participant } from "@club/shared";
import { runWhoami, type WhoamiDeps } from "./whoami.js";

const defaultParticipant: Participant = {
  id: "p_1",
  name: "alice",
  createdAt: 0,
};

describe("runWhoami", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints the participant name and id on success", async () => {
    const deps: WhoamiDeps = { me: vi.fn().mockResolvedValue(defaultParticipant) };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runWhoami(deps);
    expect(deps.me).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("alice  id=p_1");
  });

  it("propagates an SDK error through to the caller", async () => {
    const deps: WhoamiDeps = {
      me: vi.fn().mockRejectedValue(new Error("network unreachable")),
    };
    await expect(runWhoami(deps)).rejects.toThrow("network unreachable");
  });
});
