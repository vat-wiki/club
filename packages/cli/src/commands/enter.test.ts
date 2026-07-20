import { describe, expect,it } from "vitest";

import type { Room } from "@club/shared";

import { runEnter } from "./enter.js";
import type { ClubConfig } from "../config.js";

// Fakes for the two deps runEnter depends on. `calls` records the createRoom
// arg; `saved` captures the last config write.
function makeDeps() {
  const calls: string[] = [];
  const saved: ClubConfig[] = [];
  const room: Room = {
    id: "01ROOMID0000000000000000001",
    slug: "deploy-debug",
    createdAt: 1719700000000,
    lastActivityAt: null,
  };
  return {
    calls,
    saved,
    room,
    deps: {
      createRoom: async (name: string) => {
        calls.push(name);
        return { ...room, slug: name };
      },
      saveConfig: (cfg: ClubConfig) => {
        saved.push(cfg);
      },
    },
  };
}

const CONFIG: ClubConfig = { server: "http://localhost:6200", key: "club_agent_x" };

describe("runEnter", () => {
  it("creates the room and writes it as the default, preserving server+key", async () => {
    const ctx = makeDeps();
    await runEnter({ room: "deploy-debug", config: CONFIG }, ctx.deps);
    expect(ctx.calls).toEqual(["deploy-debug"]);
    expect(ctx.saved).toEqual([
      { server: "http://localhost:6200", key: "club_agent_x", room: "deploy-debug" },
    ]);
  });

  it("overwrites a prior default room with the new one", async () => {
    const ctx = makeDeps();
    const priorRoom: ClubConfig = { ...CONFIG, room: "general" };
    await runEnter({ room: "internal", config: priorRoom }, ctx.deps);
    expect(ctx.saved[0]).toEqual({ ...CONFIG, room: "internal" });
    // The prior room must NOT leak through.
    expect(ctx.saved[0]?.room).toBe("internal");
  });

  it("trims whitespace from the room arg before validating/creating", async () => {
    const ctx = makeDeps();
    await runEnter({ room: "  deploy-debug  ", config: CONFIG }, ctx.deps);
    expect(ctx.calls).toEqual(["deploy-debug"]);
    expect(ctx.saved[0]?.room).toBe("deploy-debug");
  });

  it("rejects an invalid slug before any network call or config write", async () => {
    const ctx = makeDeps();
    await expect(runEnter({ room: "Bad Name!", config: CONFIG }, ctx.deps)).rejects.toThrow(
      /invalid room name/,
    );
    expect(ctx.calls).toEqual([]);
    expect(ctx.saved).toEqual([]);
  });

  it("rejects an uppercase slug (slug is lowercase-only)", async () => {
    const ctx = makeDeps();
    await expect(runEnter({ room: "General", config: CONFIG }, ctx.deps)).rejects.toThrow(
      /invalid room name/,
    );
  });

  it("accepts general as a valid (system) room to enter", async () => {
    const ctx = makeDeps();
    await runEnter({ room: "general", config: CONFIG }, ctx.deps);
    expect(ctx.calls).toEqual(["general"]);
    expect(ctx.saved[0]?.room).toBe("general");
  });

  it("returns the ensured room", async () => {
    const ctx = makeDeps();
    const res = await runEnter({ room: "deploy-debug", config: CONFIG }, ctx.deps);
    expect(res.room.slug).toBe("deploy-debug");
  });
});
