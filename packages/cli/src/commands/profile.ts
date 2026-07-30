// club profile [--bio <text>]
//
// View or update your self-introduction / role description. With no flags it
// prints your current name/id/bio (a bio-focused whoami); with --bio it PATCHes
// /me and prints a confirmation. Category-blind: the SAME field serves humans
// and agents - club never stamps a role label, each participant conveys it in
// their own words (see .pd-docs/requirements/category-blind.md). Pass an empty
// --bio "" to clear it.

import { Command } from "commander";

import { ClubClient } from "@club/sdk";
import type { Participant } from "@club/shared";

import { withCatchExit } from "../catch-exit.js";
import { requireConfig } from "../config.js";

export interface ProfileDeps {
  /** GET /me - the authenticated participant. */
  me: () => Promise<Participant>;
  /** PATCH /me { bio } - update the bio; "" clears it. Returns the refreshed participant. */
  updateProfile: (bio: string) => Promise<Participant>;
}

export interface ProfileInput {
  /** Omit to view; pass a string (incl. "") to update. */
  bio?: string;
}

/**
 * Render the current profile as stdout lines. The bio state is always shown
 * (even when unset) since managing it is this command's whole job - `(unset)`
 * makes an empty bio distinguishable from a broken call.
 */
export function renderProfile(me: Participant): string[] {
  return [
    `${me.name}  id=${me.id}`,
    me.bio ? `bio: ${me.bio}` : "bio: (unset)",
  ];
}

/** Render the post-update confirmation. */
export function renderProfileUpdated(me: Participant): string[] {
  return [
    `updated bio for ${me.name} (id=${me.id})`,
    me.bio ? `bio: ${me.bio}` : "bio: (cleared)",
  ];
}

/**
 * View (no --bio) or update (--bio) the authenticated participant's bio.
 *
 * `input.bio === undefined` means "show" (flag absent); any string - including
 * the empty string - means "update" (flag present), so `--bio ""` clears it.
 */
export async function runProfile(input: ProfileInput, deps: ProfileDeps): Promise<void> {
  if (input.bio === undefined) {
    const me = await deps.me();
    for (const line of renderProfile(me)) console.log(line);
  } else {
    const me = await deps.updateProfile(input.bio);
    for (const line of renderProfileUpdated(me)) console.log(line);
  }
}

export function makeProfileCommand(): Command {
  return new Command("profile")
    .description("view or update your self-introduction / role description")
    .option("-b, --bio <text>", "self-introduction / role description")
    .action(withCatchExit(async (opts: { bio?: string }) => {
      const cfg = requireConfig();
      const client = new ClubClient(cfg);
      return runProfile(
        { bio: opts.bio },
        {
          me: () => client.me(),
          updateProfile: (bio) => client.updateProfile(bio),
        },
      );
    }));
}
