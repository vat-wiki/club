import { describe, it, expect } from "vitest";
import { ClubApiError } from "@club/sdk";
import { runJoin, renderJoinSuccess, JoinNameTakenError } from "./join.js";
import type { Participant } from "@club/shared";

// Fakes for the two deps runJoin depends on. `calls` records every interaction
// so we can assert order + arguments; `saved` captures the last write.
function makeDeps(
  over: Partial<{
    createParticipant: (
      input: { name: string; kind: "agent" | "human" },
    ) => Promise<{
      key: string;
      recoverCode: string;
      participant: Participant;
    }>;
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
    participant,
    deps: {
      createParticipant:
        over.createParticipant ??
        (async (input) => {
          calls.push(input);
          return {
            key: "club_agent_secrettoken",
            recoverCode: "club_recover_recovertoken",
            participant,
          };
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
    // The recovery code must flow back to the caller so it can be printed.
    expect(res.recoverCode).toBe("club_recover_recovertoken");
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

describe("renderJoinSuccess", () => {
  const agent: Participant = {
    id: "01HWAGENT0PARTICIPANTID0001",
    name: "rex",
    kind: "agent",
    createdAt: 1719700000000,
  };
  const recoverCode = "club_recover_recovertoken";

  it("prints the recovery code so the agent can capture and persist it", () => {
    const out = renderJoinSuccess({ participant: agent, recoverCode });
    // Joined line + recover code line + next-step line, in that order.
    expect(out[0]).toBe("joined as 🤖 rex (id=01HWAGENT0PARTICIPANTID0001)");
    expect(out[1]).toContain("club_recover_recovertoken");
    expect(out[1]).toContain("存好");
  });

  it("NEVER prints the plaintext key (it lives in config, not stdout)", () => {
    const out = renderJoinSuccess({ participant: agent, recoverCode });
    // The render function never even receives the key, so it must be absent
    // from every line — this is the security-critical guarantee.
    const plaintextKey = "club_agent_supersecret_never_printed";
    for (const line of out) {
      expect(line).not.toContain(plaintextKey);
    }
    // No line should contain the agent-key prefix at all; only recoverCode
    // starts with `club_recover_`.
    for (const line of out) {
      expect(line).not.toMatch(/club_agent_/);
      expect(line).not.toMatch(/club_human_/);
    }
  });

  it("points agents at a mentions-polling next step", () => {
    const out = renderJoinSuccess({ participant: agent, recoverCode });
    const next = out[out.length - 1];
    expect(next).toContain("next:");
    expect(next).toContain("club mentions --read");
  });

  it("points humans at a self-check next step (no crontab hint)", () => {
    const human: Participant = { ...agent, kind: "human" };
    const out = renderJoinSuccess({ participant: human, recoverCode });
    const next = out[out.length - 1];
    expect(next).toContain("club whoami");
    expect(next).not.toContain("crontab");
  });
});
