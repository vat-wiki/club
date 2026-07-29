import { describe, expect,it } from "vitest";

import { ClubApiError } from "@club/sdk";
import type { Participant } from "@club/shared";

import { JoinNameTakenError,renderJoinSuccess, runJoin } from "./join.js";

// Fakes for the two deps runJoin depends on. `calls` records every interaction
// so we can assert order + arguments; `saved` captures the last write.
function makeDeps(
  over: Partial<{
    createParticipant: (input: { name: string }) => Promise<{
      key: string;
      recoverCode: string;
      participant: Participant;
    }>;
  }> = {},
) {
  const saved: { server: string; key: string }[] = [];
  const calls: { name: string }[] = [];
  const participant: Participant = {
    id: "01HWAGENT0PARTICIPANTID0001",
    name: "rex",
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
            key: "club_secrettoken",
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
      { name: "rex", server: "http://localhost:6200" },
      ctx.deps,
    );
    expect(ctx.calls).toEqual([{ name: "rex" }]);
    expect(ctx.saved).toEqual([
      { server: "http://localhost:6200", key: "club_secrettoken" },
    ]);
    expect(res.participant.id).toBe("01HWAGENT0PARTICIPANTID0001");
    // The recovery code must flow back to the caller so it can be printed.
    expect(res.recoverCode).toBe("club_recover_recovertoken");
  });

  it("trims a trailing slash from the server url before saving", async () => {
    const ctx = makeDeps();
    await runJoin({ name: "rex", server: "http://x:6200/" }, ctx.deps);
    expect(ctx.saved[0]?.server).toBe("http://x:6200");
  });

  it("maps a 409 (name taken) to a friendly JoinNameTakenError", async () => {
    const ctx = makeDeps({
      createParticipant: async () => {
        throw new ClubApiError(`name "rex" is taken`, 409);
      },
    });
    await expect(
      runJoin({ name: "rex", server: "http://x" }, ctx.deps),
    ).rejects.toBeInstanceOf(JoinNameTakenError);
    // Nothing must have been written when minting failed.
    expect(ctx.saved).toEqual([]);
    // And the friendly message names the requested callsign.
    await expect(
      runJoin({ name: "rex", server: "http://x" }, ctx.deps),
    ).rejects.toThrow(`name "rex" already taken; choose another`);
  });

  it("does not swallow non-409 errors (e.g. 400 bad name, network)", async () => {
    const ctx = makeDeps({
      createParticipant: async () => {
        throw new ClubApiError("name too long", 400);
      },
    });
    await expect(
      runJoin({ name: "x".repeat(40), server: "http://x" }, ctx.deps),
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
      runJoin({ name: "rex", server: "http://unreachable" }, ctx.deps),
    ).rejects.toThrow(/network/);
    expect(ctx.saved).toEqual([]);
  });
});

describe("renderJoinSuccess", () => {
  const participant: Participant = {
    id: "01HWAGENT0PARTICIPANTID0001",
    name: "rex",
    createdAt: 1719700000000,
  };
  const recoverCode = "club_recover_recovertoken";

  it("prints the recovery code so it can be captured and persisted", () => {
    const out = renderJoinSuccess({ participant, recoverCode });
    // Joined line + recover code line + next-step line, in that order.
    expect(out[0]).toBe("joined as rex (id=01HWAGENT0PARTICIPANTID0001)");
    expect(out[1]).toContain("club_recover_recovertoken");
    expect(out[1]).toContain("存好");
  });

  it("NEVER prints the plaintext key (it lives in config, not stdout)", () => {
    const out = renderJoinSuccess({ participant, recoverCode });
    // The render function never even receives the key, so it must be absent
    // from every line — this is the security-critical guarantee.
    const plaintextKey = "club_supersecret_never_printed";
    for (const line of out) {
      expect(line).not.toContain(plaintextKey);
    }
    // No line should carry a participant-key prefix; only recoverCode starts
    // with `club_recover_`. (Legacy keys used club_human_/club_agent_ prefixes;
    // new keys are prefix-free — either way nothing should leak here.)
    for (const line of out) {
      expect(line).not.toMatch(/club_agent_/);
      expect(line).not.toMatch(/club_human_/);
    }
  });

  it("points at a self-check next step", () => {
    const out = renderJoinSuccess({ participant, recoverCode });
    const next = out[out.length - 1];
    expect(next).toContain("next:");
    expect(next).toContain("club whoami");
  });
});
