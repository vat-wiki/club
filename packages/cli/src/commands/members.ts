import { Command } from "commander";

import { withAuthClient } from "../client-factory.js";

// club members [--room <slug>]
//
// List participants in the current room (or --room <slug>). Each name is
// printed on its own line for agent consumption; a friendly
// "(no members)" footer appears when the room is empty.

export function makeMembersCommand(): Command {
  return new Command("members")
    .description("list room members")
    .action(withAuthClient(async (_cfg, _args, client) => {
      const list = await client.members();
      for (const p of list) {
        console.log(p.name);
      }
      if (list.length === 0) console.log("(no members)");
    }));
}
