// club kick <id>
//
// "Kick = account deactivated" in the open model: remove a participant. Anyone
// may kick anyone (no second factor). Revokes the target's key and hides them
// from the roster, mirroring the self-delete path. Authored messages are
// preserved so channel history stays intact.

import { Command } from "commander";

import { ClubClient } from "@club/sdk";

import { withCatchExit } from "../catch-exit.js";
import { requireConfig } from "../config.js";

export interface KickDeps {
  /** Simulate the SDK's `ClubClient.kickParticipant(id)` method. */
  kickParticipant: (id: string) => Promise<void>;
}

/**
 * Kick (deactivate the account of) a participant. Open model: any authenticated
 * participant may remove any participant. Dependency-injected for testing.
 */
export async function runKick(opts: { id: string }, deps: KickDeps): Promise<void> {
  await deps.kickParticipant(opts.id.trim());
  console.log(`kicked ${opts.id}`);
}

/**
 * Build the `club kick` commander sub-command.
 *
 * Removes a participant (deactivates their account: revokes key, hides from roster; authored messages preserved). Anyone may
 * kick anyone — there is no second factor in the open model.
 *
 * @returns A configured `Command` instance to register with the CLI program.
 */
export function makeKickCommand(): Command {
  return new Command("kick")
    .description("kick a participant (deactivates their account; messages preserved; anyone may)")
    .argument("<id>", "participant ID to kick")
    .action(
      withCatchExit(async (id: string) => {
        const cfg = requireConfig();
        const client = new ClubClient(cfg);
        return runKick({ id }, { kickParticipant: (i) => client.kickParticipant(i) });
      }),
    );
}
