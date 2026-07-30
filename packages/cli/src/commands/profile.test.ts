import { afterEach, describe, expect, it, vi } from "vitest";

import type { Participant } from "@club/shared";

import {
  type ProfileDeps,
  renderProfile,
  renderProfileUpdated,
  runProfile,
} from "./profile.js";

const me: Participant = {
  id: "p_1",
  name: "alice",
  bio: "",
  createdAt: 0,
};

function makeDeps(over: Partial<ProfileDeps> = {}): ProfileDeps {
  return {
    me: over.me ?? vi.fn().mockResolvedValue(me),
    updateProfile:
      over.updateProfile ?? vi.fn().mockResolvedValue(me),
  };
}

describe("renderProfile", () => {
  it("shows name, id, and the bio state", () => {
    expect(renderProfile(me)).toEqual(["alice  id=p_1", "bio: (unset)"]);
  });

  it("shows the bio when set", () => {
    const p: Participant = { ...me, bio: "运维 agent" };
    expect(renderProfile(p)).toEqual(["alice  id=p_1", "bio: 运维 agent"]);
  });
});

describe("renderProfileUpdated", () => {
  it("confirms the update and echoes the new bio", () => {
    const p: Participant = { ...me, bio: "产品经理" };
    expect(renderProfileUpdated(p)).toEqual([
      "updated bio for alice (id=p_1)",
      "bio: 产品经理",
    ]);
  });

  it("reports (cleared) when the bio was emptied", () => {
    expect(renderProfileUpdated(me)).toEqual([
      "updated bio for alice (id=p_1)",
      "bio: (cleared)",
    ]);
  });
});

describe("runProfile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls me() and prints the profile when --bio is absent", async () => {
    const deps = makeDeps();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runProfile({}, deps);
    expect(deps.me).toHaveBeenCalledTimes(1);
    expect(deps.updateProfile).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("alice  id=p_1");
    expect(log).toHaveBeenCalledWith("bio: (unset)");
  });

  it("calls updateProfile(bio) and prints confirmation when --bio is set", async () => {
    const updated: Participant = { ...me, bio: "运维 agent" };
    const deps = makeDeps({
      updateProfile: vi.fn().mockResolvedValue(updated),
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runProfile({ bio: "运维 agent" }, deps);
    expect(deps.updateProfile).toHaveBeenCalledWith("运维 agent");
    expect(deps.me).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("updated bio for alice (id=p_1)");
    expect(log).toHaveBeenCalledWith("bio: 运维 agent");
  });

  it("passes an empty string through to updateProfile (clears the bio)", async () => {
    const deps = makeDeps({
      updateProfile: vi.fn().mockResolvedValue({ ...me, bio: "" }),
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runProfile({ bio: "" }, deps);
    expect(deps.updateProfile).toHaveBeenCalledWith("");
    expect(log).toHaveBeenCalledWith("bio: (cleared)");
  });

  it("propagates an SDK error through to the caller", async () => {
    const deps = makeDeps({
      updateProfile: vi.fn().mockRejectedValue(new Error("network unreachable")),
    });
    await expect(runProfile({ bio: "x" }, deps)).rejects.toThrow("network unreachable");
  });
});
