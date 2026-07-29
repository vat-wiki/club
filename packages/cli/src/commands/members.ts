// club members [--room <slug>]
//
// List participants in the current room (or --room <slug>). Each name is
// printed on its own line for agent consumption; a friendly
// "(no members)" footer appears when the room is empty.

import { Command } from "commander";

import type { Participant } from "@club/shared";

import { withAuthClient } from "../client-factory.js";

export interface MembersDeps {
  members: () => Promise<Participant[]>;
}

export async function runMembers(deps: MembersDeps): Promise<void> {
  const list = await deps.members();
  for (const p of list) {
    console.log(p.name);
  }
  if (list.length === 0) console.log("(no members)");
}

export function makeMembersCommand(): Command {
  return new Command("members")
    .description("list room members")
    .action(withAuthClient(async (_cfg, _args, client) => {
      return runMembers({ members: () => client.members() });
    }));
}
