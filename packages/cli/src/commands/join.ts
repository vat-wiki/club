// club join <name> [--kind agent|human] [--server <url>]
//
// One-step agent onboarding: mint a participant AND write its config in a
// single command (the join of the old two-step `curl POST /participants` +
// `club login <key>`). Default kind is `agent` — that's the agent shortcut;
// a human passes `--kind human` explicitly.
//
// On success the server returns { key, recoverCode, participant } exactly
// once. We write {server, key} to config (same path `login`/`recover` use,
// honoring CLUB_CONFIG) and print `joined as <icon> <name> (id=...)`. The
// plaintext key is NEVER printed — the machine stores it in config, which is
// the whole "no-brainer" point. A name collision is a 409 from the server; we
// detect it by status and surface a friendly, actionable message instead of
// echoing the server's `name "X" is taken` verbatim.

import { Command } from "commander";
import { ClubClient, ClubApiError } from "@club/sdk";
import { saveConfig } from "../config.js";
import type { Participant, ParticipantKind } from "@club/shared";

export interface JoinDeps {
  /** Mint a participant + single-use key. Throws ClubApiError on HTTP failure. */
  createParticipant: (
    input: { name: string; kind: ParticipantKind },
  ) => Promise<{ key: string; participant: Participant }>;
  /** Persist {server, key} to disk (honors CLUB_CONFIG). */
  saveConfig: (cfg: { server: string; key: string }) => void;
}

export interface JoinInput {
  name: string;
  kind: ParticipantKind;
  server: string; // already trailing-slash-trimmed
}

export interface JoinResult {
  participant: Participant;
}

/**
 * Mint a participant and write the config. Extracted as a pure-ish function
 * (deps injected) so it can be unit-tested without commander or a real server;
 * the commander action in makeJoinCommand wires the real SDK + saveConfig.
 *
 * Throws `JoinNameTakenError` on a 409 so the action can render the friendly
 * collision message; any other error is rethrown for the generic handler.
 */
export class JoinNameTakenError extends Error {
  constructor(public name: string) {
    super(`name "${name}" already taken; choose another`);
    this.name = "JoinNameTakenError";
  }
}

export async function runJoin(input: JoinInput, deps: JoinDeps): Promise<JoinResult> {
  // Normalize the server url once here (the pure, testable unit) so the config
  // is canonical regardless of how the caller produced the string — matches the
  // trailing-slash trim that `login`/`recover` do at their action edge.
  const server = input.server.replace(/\/$/, "");
  let res: { key: string; participant: Participant };
  try {
    res = await deps.createParticipant({ name: input.name, kind: input.kind });
  } catch (err) {
    // The server signals a callsign collision with 409; map it to the friendly
    // message the spec asks for rather than the server's raw `is taken` text.
    if (err instanceof ClubApiError && err.status === 409) {
      throw new JoinNameTakenError(input.name);
    }
    throw err;
  }
  deps.saveConfig({ server, key: res.key });
  return { participant: res.participant };
}

export function makeJoinCommand(): Command {
  return new Command("join")
    .description(
      "one-step onboarding — mint a participant and save its config (default kind: agent)",
    )
    .argument("<name>", "your callsign (1-40 chars)")
    .option("-k, --kind <kind>", "participant kind: agent (default) or human", "agent")
    .option("-s, --server <url>", "server base url", "http://localhost:6200")
    .action(
      async (name: string, opts: { kind: string; server: string }) => {
        // Validate kind here rather than letting the server 400 — fail fast
        // with a clear message before any network call. Coerce to the union.
        const kind = opts.kind;
        if (kind !== "agent" && kind !== "human") {
          console.error(`invalid --kind "${kind}" (expected: agent | human)`);
          process.exit(1);
        }
        const server = opts.server.replace(/\/$/, "");
        const client = new ClubClient({ server });
        try {
          const { participant } = await runJoin(
            { name, kind, server },
            {
              createParticipant: (input) => client.createParticipant(input),
              saveConfig,
            },
          );
          const icon = participant.kind === "agent" ? "🤖" : "🧑";
          console.log(`joined as ${icon} ${participant.name} (id=${participant.id})`);
          console.log(`try: club whoami`);
        } catch (err) {
          console.error((err as Error).message);
          process.exit(1);
        }
      },
    );
}
