import { afterEach,beforeEach, describe, expect, it, vi } from "vitest";

import { ClubApiError } from "@club/sdk";
import type { Channel,Participant } from "@club/shared";

import { channelDisplayLabel, type InfoDeps,runInfo } from "./info.js";

const fixtureMe: Participant = { id: "p1", name: "alice", createdAt: 0 };
const fixtureChannels: Channel[] = [
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
    channels: vi.fn().mockResolvedValue(fixtureChannels),
    members: vi.fn().mockResolvedValue(fixtureMembers),
    ...over,
  };
}

describe("runInfo", () => {
  it("prints identity, server, current channel, counts and lists", async () => {
    const deps = makeDeps();
    await runInfo({ server: "http://localhost:6200", currentChannel: "general" }, deps);
    expect(console.log).toHaveBeenCalledWith(`You: ${fixtureMe.name} (id=${fixtureMe.id})`);
    expect(console.log).toHaveBeenCalledWith("Server: http://localhost:6200");
    expect(console.log).toHaveBeenCalledWith("Current channel: #general");
    expect(console.log).toHaveBeenCalledWith("Total channels: 2");
    expect(console.log).toHaveBeenCalledWith("Total members: 2");
  });

  it("calls all three SDK methods in parallel", async () => {
    const deps = makeDeps();
    await runInfo({ server: "s", currentChannel: "general" }, deps);
    expect(deps.me).toHaveBeenCalledTimes(1);
    expect(deps.channels).toHaveBeenCalledTimes(1);
    expect(deps.members).toHaveBeenCalledTimes(1);
  });

  it("marks the current channel with '*' in the channel list", async () => {
    const deps = makeDeps();
    await runInfo({ server: "s", currentChannel: "general" }, deps, 10000);
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toContainEqual([" *#general active 0m ago"]);
    expect(calls).toContainEqual(["  #random empty"]);
  });

  it("marks a non-general current channel with '*' correctly", async () => {
    const deps = makeDeps();
    await runInfo({ server: "s", currentChannel: "random" }, deps, 10000);
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toContainEqual([" *#random empty"]);
    expect(calls).toContainEqual(["  #general active 0m ago"]);
  });

  it("renders the member roster at the end", async () => {
    const deps = makeDeps();
    await runInfo({ server: "s", currentChannel: "general" }, deps);
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toContainEqual(["  alice"]);
    expect(calls).toContainEqual(["  bob"]);
  });

  it("propagates an SDK error from me()", async () => {
    const deps = makeDeps({
      me: vi.fn().mockRejectedValue(new ClubApiError("network", 504)),
    });
    await expect(
      runInfo({ server: "s", currentChannel: "general" }, deps),
    ).rejects.toThrow("network");
  });

  it("propagates an SDK error from channels()", async () => {
    const deps = makeDeps({
      channels: vi.fn().mockRejectedValue(new ClubApiError("offline", 408)),
    });
    await expect(
      runInfo({ server: "s", currentChannel: "general" }, deps),
    ).rejects.toThrow("offline");
  });

  it("handles an empty channel list gracefully", async () => {
    const deps = makeDeps({ channels: vi.fn().mockResolvedValue([]) });
    await expect(
      runInfo({ server: "s", currentChannel: "general" }, deps),
    ).resolves.toBeUndefined();
    expect(console.log).toHaveBeenCalledWith("Total channels: 0");
  });
});

describe("channelDisplayLabel", () => {
  it("returns 'empty' when lastActivityAt is null", () => {
    const channel = { id: "x", slug: "x", createdAt: 0, lastActivityAt: null };
    expect(channelDisplayLabel(channel)).toBe("empty");
  });

  it("returns 'active N m ago' based on lastActivityAt and now", () => {
    const now = 700_000;
    const channel: Channel = { id: "x", slug: "x", createdAt: 0, lastActivityAt: 100_000 };
    expect(channelDisplayLabel(channel, now)).toBe("active 10m ago");
  });
});
