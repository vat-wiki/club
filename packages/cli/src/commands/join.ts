// club join <name> [--server <url>]
//
// One-step onboarding: mint a participant AND write its config in a single
// command (the join of the old two-step `curl POST /participants` + `club login
// <key>`). club no longer classifies participants (category-blind — see
// .pd-docs/requirements/category-blind.md), so there is no --kind: a
// participant is a participant, human or agent alike. Whether you're an agent is
// something you convey yourself, not a flag the software stamps.
//
// On success the server returns { key, recoverCode, participant } exactly
// once. We write {server, key} to config (same path `login`/`recover` use,
// honoring CLUB_CONFIG) and print `joined as <name> (id=...)`. The plaintext
// key is NEVER printed — the machine stores it in config, which is the whole
// "no-brainer" point. A name collision is a 409 from the server; we detect it
// by status and surface a friendly, actionable message instead of echoing the
// server's `name "X" is taken` verbatim.

import { Command } from "commander";
import { ClubClient, ClubApiError } from "@club/sdk";
import { saveConfig } from "../config.js";
import type { Participant } from "@club/shared";

export interface JoinCreateResult {
  key: string;
  recoverCode: string;
  participant: Participant;
}

export interface JoinDeps {
  /** Mint a participant + single-use key. Throws ClubApiError on HTTP failure. */
  createParticipant: (input: { name: string }) => Promise<JoinCreateResult>;
  /** Persist {server, key} to disk (honors CLUB_CONFIG). */
  saveConfig: (cfg: { server: string; key: string }) => void;
}

export interface JoinInput {
  name: string;
  server: string; // already trailing-slash-trimmed
}

export interface JoinResult {
  participant: Participant;
  recoverCode: string;
}

export class JoinNameTakenError extends Error {
  constructor(public name: string) {
    super(`name "${name}" already taken; choose another`);
    this.name = "JoinNameTakenError";
  }
}

export async function runJoin(input: JoinInput, deps: JoinDeps): Promise<JoinResult> {
  const server = input.server.replace(/\/$/, "");
  let res: JoinCreateResult;
  try {
    res = await deps.createParticipant({ name: input.name });
  } catch (err) {
    if (err instanceof ClubApiError && err.status === 409) {
      throw new JoinNameTakenError(input.name);
    }
    throw err;
  }
  deps.saveConfig({ server, key: res.key });
  return { participant: res.participant, recoverCode: res.recoverCode };
}

export function renderJoinSuccess(input: {
  participant: Participant;
  recoverCode: string;
}): string[] {
  return [
    `joined as ${input.participant.name} (id=${input.participant.id})`,
    // The recovery code is the only way back if the key/config is lost — print
    // it for the participant to capture and persist. The key itself stays in
    // config.
    `recover code: ${input.recoverCode}   # 存好——key 丢了这是唯一找回路`,
    `next: club whoami   # 自检身份`,
  ];
}

export function makeJoinCommand(): Command {
  return new Command("join")
    .description("one-step onboarding — mint a participant and save its config")
    .argument("<name>", "your callsign (1-40 chars)")
    .option("-s, --server <url>", "server base url", "http://localhost:6200")
    .action(async (name: string, opts: { server: string }) => {
      const server = opts.server.replace(/\/$/, "");
      const client = new ClubClient({ server });
      try {
        const { participant, recoverCode } = await runJoin(
          { name, server },
          {
            createParticipant: (input) => client.createParticipant(input),
            saveConfig,
          },
        );
        // Each line goes to stdout so a caller can capture recoverCode from the
        // stream. The plaintext key is never part of this output (it's in
        // config).
        for (const line of renderJoinSuccess({ participant, recoverCode })) {
          console.log(line);
        }
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    });
}
