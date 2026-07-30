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
 * Render the identity of a participant as stdout lines.
 *
 * The first line is always `name  id=...`; a non-empty bio is surfaced on a
 * second `bio: ...` line so a participant's self-description is visible at a
 * glance. An unset bio (empty string) is omitted rather than printed as empty.
 */
export function renderWhoami(me: Participant): string[] {
  const lines = [`${me.name}  id=${me.id}`];
  if (me.bio) lines.push(`bio: ${me.bio}`);
  return lines;
}

/**
 * Print the identity of the currently logged-in participant.
 *
 * Dependency injection is used so the CLI can substitute a mocked `me()` in
 * tests without requiring a real network connection.
 */
export async function runWhoami(deps: WhoamiDeps): Promise<void> {
  const me = await deps.me();
  for (const line of renderWhoami(me)) console.log(line);
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