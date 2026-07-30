// club members [--channel <slug>]
//
// List participants in the current channel (or --channel <slug>). Each member
// is printed on its own line for agent consumption - name first, with the
// member's bio (when set) appended so participants are easier to tell apart;
// a friendly "(no members)" footer appears when the channel is empty.

import { Command } from "commander";

import type { Participant } from "@club/shared";

import { withAuthClient } from "../client-factory.js";

export interface MembersDeps {
  members: () => Promise<Participant[]>;
}

/**
 * Render one member line. Pure so the bio rule can be unit-tested without a
 * server. Name first; when the member has set a bio it follows after a `bio:`
 * marker. The marker is a reliable split point because participant names never
 * contain a colon (the name whitelist excludes it), so a caller can always
 * recover name/bio from the line. An unset bio is omitted to keep a long
 * roster scannable.
 *
 *   alice  bio: 运维   ← bio set
 *   bob              ← bio unset
 */
export function formatMemberLine(p: Participant): string {
  return p.bio ? `${p.name}  bio: ${p.bio}` : p.name;
}

export async function runMembers(deps: MembersDeps): Promise<void> {
  const list = await deps.members();
  for (const p of list) {
    console.log(formatMemberLine(p));
  }
  if (list.length === 0) console.log("(no members)");
}

export function makeMembersCommand(): Command {
  return new Command("members")
    .description("list channel members")
    .action(withAuthClient(async (_cfg, _args, client) => {
      return runMembers({ members: () => client.members() });
    }));
}
