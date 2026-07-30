import { afterEach,describe, expect, it, vi } from "vitest";

import type { Participant } from "@club/shared";

import { renderWhoami, runWhoami, type WhoamiDeps } from "./whoami.js";

const defaultParticipant: Participant = {
  id: "p_1",
  name: "alice",
  bio: "",
  createdAt: 0,
};

describe("renderWhoami", () => {
  it("prints name and id on the first line", () => {
    expect(renderWhoami(defaultParticipant)[0]).toBe("alice  id=p_1");
  });

  it("omits the bio line when bio is empty", () => {
    expect(renderWhoami(defaultParticipant)).toEqual(["alice  id=p_1"]);
  });

  it("shows a bio line when bio is set", () => {
    const p: Participant = { ...defaultParticipant, bio: "运维 agent" };
    expect(renderWhoami(p)).toEqual(["alice  id=p_1", "bio: 运维 agent"]);
  });
});

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

  it("prints the bio line when bio is non-empty", async () => {
    const me: Participant = { ...defaultParticipant, bio: "产品经理 🚀" };
    const deps: WhoamiDeps = { me: vi.fn().mockResolvedValue(me) };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runWhoami(deps);
    expect(log).toHaveBeenCalledWith("bio: 产品经理 🚀");
  });

  it("does not print a bio line when bio is empty", async () => {
    const deps: WhoamiDeps = { me: vi.fn().mockResolvedValue(defaultParticipant) };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runWhoami(deps);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("bio:"));
  });

  it("propagates an SDK error through to the caller", async () => {
    const deps: WhoamiDeps = {
      me: vi.fn().mockRejectedValue(new Error("network unreachable")),
    };
    await expect(runWhoami(deps)).rejects.toThrow("network unreachable");
  });
});
