// club whoami
//
// Show the participant details for the currently logged-in key.

import { Command } from "commander";

import { ClubClient } from "@club/sdk";
import type { Participant } from "@club/shared";

import { withCatchExit } from "../catch-exit.js";
import { requireConfig } from "../config.js";

export interface WhoamiDeps {
  /** Simulate the SDK's `ClubClient.me()` method. */
  me: () => Promise<Participant>;
}

/**
 * Print the identity of the currently logged-in participant.
 *
 * Dependency injection is used so the CLI can substitute a mocked `me()` in
 * tests without requiring a real network connection.
 */
export async function runWhoami(deps: WhoamiDeps): Promise<void> {
  const me = await deps.me();
  console.log(`${me.name}  id=${me.id}`);
}

export function makeWhoamiCommand(): Command {
  return new Command("whoami")
    .description("show who you are logged in as")
    .action(withCatchExit(async () => {
      const cfg = requireConfig();
      const client = new ClubClient(cfg);
      return runWhoami({ me: () => client.me() });
    }));
}