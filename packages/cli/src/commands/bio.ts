// club bio <id> [text...]
//
// Set ANY participant's bio (open model: anyone may edit anyone's
// self-introduction). Pass no text (or empty) to clear. This is distinct from
// `club profile --bio`, which edits only the authenticated participant's own bio.

import { Command } from "commander";

import { ClubClient } from "@club/sdk";

import { withCatchExit } from "../catch-exit.js";
import { requireConfig } from "../config.js";

export interface SetBioDeps {
  /** Simulate the SDK's `ClubClient.updateParticipantBio(id, bio)` method. */
  updateParticipantBio: (id: string, bio: string) => Promise<void>;
}

/**
 * Set a participant's bio. `bio === ""` clears it. Dependency-injected for tests.
 */
export async function runSetBio(
  opts: { id: string; bio: string },
  deps: SetBioDeps,
): Promise<void> {
  await deps.updateParticipantBio(opts.id.trim(), opts.bio);
  console.log(opts.bio ? `set bio for ${opts.id}` : `cleared bio for ${opts.id}`);
}

/**
 * Build the `club bio` commander sub-command.
 *
 * Sets any participant's bio (open model: any participant may edit anyone's bio).
 * `club bio <id> hello world` sets it; `club bio <id>` clears it.
 *
 * @returns A configured `Command` instance to register with the CLI program.
 */
export function makeBioCommand(): Command {
  return new Command("bio")
    .description("set any participant's bio (open model: anyone may edit anyone)")
    .argument("<id>", "participant ID")
    .argument("[text...]", "bio text (omit to clear)")
    .action(
      withCatchExit(async (id: string, text: string[] = []) => {
        const cfg = requireConfig();
        const client = new ClubClient(cfg);
        const bio = text.join(" ").trim();
        return runSetBio(
          { id, bio },
          { updateParticipantBio: (i, b) => client.updateParticipantBio(i, b) },
        );
      }),
    );
}
