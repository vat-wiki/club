import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Participant, Room } from "@club/shared";
import { ClubApiError } from "@club/sdk";
import { runInfo, roomDisplayLabel, type InfoDeps } from "./info.js";

const fixtureMe: Participant = { id: "p1", name: "alice", createdAt: 0 };
const fixtureRooms: Room[] = [
  { id: "r1", slug: "general", createdAt: 1000, lastActivityAt: 10000 },
  { id: "r2", slug: "random", createdAt: 2000, lastActivityAt: null },
];
const fixtureMembers: Participant[] = [
  { id: "p1", name: "alice", createdAt: 0 },
  { id: "p2", name: "bob", createdAt: 100 },
];

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeDeps(over: Partial<InfoDeps> = {}): InfoDeps {
  return {
    me: vi.fn().mockResolvedValue(fixtureMe),
    rooms: vi.fn().mockResolvedValue(fixtureRooms),
    members: vi.fn().mockResolvedValue(fixtureMembers),
    ...over,
  };
}

describe("runInfo", () => {
  it("prints identity, server, current room, counts and lists", async () => {
    const deps = makeDeps();
    await runInfo({ server: "http://localhost:6200", currentRoom: "general" }, deps);
    expect(console.log).toHaveBeenCalledWith(`You: ${fixtureMe.name} (id=${fixtureMe.id})`);
    expect(console.log).toHaveBeenCalledWith("Server: http://localhost:6200");
    expect(console.log).toHaveBeenCalledWith("Current room: #general");
    expect(console.log).toHaveBeenCalledWith("Total rooms: 2");
    expect(console.log).toHaveBeenCalledWith("Total members: 2");
  });

  it("calls all three SDK methods in parallel", async () => {
    const deps = makeDeps();
    await runInfo({ server: "s", currentRoom: "general" }, deps);
    expect(deps.me).toHaveBeenCalledTimes(1);
    expect(deps.rooms).toHaveBeenCalledTimes(1);
    expect(deps.members).toHaveBeenCalledTimes(1);
  });

  it("marks the current room with '*' in the room list", async () => {
    const deps = makeDeps();
    await runInfo({ server: "s", currentRoom: "general" }, deps);
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toContainEqual([" *#general active 0m ago"]);
    expect(calls).toContainEqual(["  #random empty"]);
  });

  it("marks a non-general current room with '*' correctly", async () => {
    const deps = makeDeps();
    await runInfo({ server: "s", currentRoom: "random" }, deps);
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toContainEqual([" *#random empty"]);
    expect(calls).toContainEqual(["  #general active 0m ago"]);
  });

  it("renders the member roster at the end", async () => {
    const deps = makeDeps();
    await runInfo({ server: "s", currentRoom: "general" }, deps);
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toContainEqual(["  alice"]);
    expect(calls).toContainEqual(["  bob"]);
  });

  it("propagates an SDK error from me()", async () => {
    const deps = makeDeps({
      me: vi.fn().mockRejectedValue(new ClubApiError("network", 504)),
    });
    await expect(
      runInfo({ server: "s", currentRoom: "general" }, deps),
    ).rejects.toThrow("network");
  });

  it("propagates an SDK error from rooms()", async () => {
    const deps = makeDeps({
      rooms: vi.fn().mockRejectedValue(new ClubApiError("offline", 408)),
    });
    await expect(
      runInfo({ server: "s", currentRoom: "general" }, deps),
    ).rejects.toThrow("offline");
  });

  it("handles an empty room list gracefully", async () => {
    const deps = makeDeps({ rooms: vi.fn().mockResolvedValue([]) });
    await expect(
      runInfo({ server: "s", currentRoom: "general" }, deps),
    ).resolves.toBeUndefined();
    expect(console.log).toHaveBeenCalledWith("Total rooms: 0");
  });
});

describe("roomDisplayLabel", () => {
  it("returns 'empty' when lastActivityAt is null", () => {
    const room = { id: "x", slug: "x", createdAt: 0, lastActivityAt: null };
    expect(roomDisplayLabel(room)).toBe("empty");
  });

  it("returns 'active N m ago' based on lastActivityAt and now", () => {
    const now = 700_000;
    const room: Room = { id: "x", slug: "x", createdAt: 0, lastActivityAt: 100_000 };
    expect(roomDisplayLabel(room, now)).toBe("active 10m ago");
  });
});
