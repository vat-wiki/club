import { describe, it, expect } from "vitest";
import { ClubApiError } from "@club/sdk";
import { runJoin, JoinNameTakenError } from "./join.js";
import type { Participant } from "@club/shared";

// Fakes for the two deps runJoin depends on. `calls` records every interaction
// so we can assert order + arguments; `saved` captures the last write.
function makeDeps(
  over: Partial<{
    createParticipant: (
      input: { name: string; kind: "agent" | "human" },
    ) => Promise<{ key: string; participant: Participant }>;
  }> = {},
) {
  const saved: { server: string; key: string }[] = [];
  const calls: { name: string; kind: "agent" | "human" }[] = [];
  const participant: Participant = {
    id: "01HWAGENT0PARTICIPANTID0001",
    name: "rex",
    kind: "agent",
    createdAt: 1719700000000,
  };
  return {
    saved,
    calls,
    deps: {
      createParticipant:
        over.createParticipant ??
        (async (input) => {
          calls.push(input);
          return { key: "club_agent_secrettoken", participant };
        }),
      saveConfig: (cfg: { server: string; key: string }) => {
        saved.push(cfg);
      },
    },
  };
}

describe("runJoin", () => {
  it("mints a participant and writes {server, key} to config", async () => {
    const ctx = makeDeps();
    const res = await runJoin(
      { name: "rex", kind: "agent", server: "http://localhost:6200" },
      ctx.deps,
    );
    expect(ctx.calls).toEqual([{ name: "rex", kind: "agent" }]);
    expect(ctx.saved).toEqual([
      { server: "http://localhost:6200", key: "club_agent_secrettoken" },
    ]);
    expect(res.participant.id).toBe("01HWAGENT0PARTICIPANTID0001");
  });

  it("respects an explicit --kind human through to the SDK call", async () => {
    const ctx = makeDeps();
    await runJoin({ name: "ana", kind: "human", server: "http://x" }, ctx.deps);
    expect(ctx.calls).toEqual([{ name: "ana", kind: "human" }]);
  });

  it("trims a trailing slash from the server url before saving", async () => {
    const ctx = makeDeps();
    await runJoin({ name: "rex", kind: "agent", server: "http://x:6200/" }, ctx.deps);
    expect(ctx.saved[0]?.server).toBe("http://x:6200");
  });

  it("maps a 409 (name taken) to a friendly JoinNameTakenError", async () => {
    const ctx = makeDeps({
      createParticipant: async () => {
        throw new ClubApiError(`name "rex" is taken`, 409);
      },
    });
    await expect(
      runJoin({ name: "rex", kind: "agent", server: "http://x" }, ctx.deps),
    ).rejects.toBeInstanceOf(JoinNameTakenError);
    // Nothing must have been written when minting failed.
    expect(ctx.saved).toEqual([]);
    // And the friendly message names the requested callsign.
    await expect(
      runJoin({ name: "rex", kind: "agent", server: "http://x" }, ctx.deps),
    ).rejects.toThrow(`name "rex" already taken; choose another`);
  });

  it("does not swallow non-409 errors (e.g. 400 bad name, network)", async () => {
    const ctx = makeDeps({
      createParticipant: async () => {
        throw new ClubApiError("name too long", 400);
      },
    });
    await expect(
      runJoin({ name: "x".repeat(41), kind: "agent", server: "http://x" }, ctx.deps),
    ).rejects.toThrow(/name too long/);
    expect(ctx.saved).toEqual([]);
  });

  it("does not save config if the SDK call throws a network error (status 0)", async () => {
    const ctx = makeDeps({
      createParticipant: async () => {
        throw new ClubApiError("network", 0);
      },
    });
    await expect(
      runJoin({ name: "rex", kind: "agent", server: "http://unreachable" }, ctx.deps),
    ).rejects.toThrow(/network/);
    expect(ctx.saved).toEqual([]);
  });
});
