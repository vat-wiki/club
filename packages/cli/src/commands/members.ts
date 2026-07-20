import { Command } from "commander";
import { withAuthClient } from "../client-factory.js";

export function makeMembersCommand(): Command {
  return new Command("members")
    .description("list room members")
    .action(withAuthClient(async (_, client) => {
      const list = await client.members();
      for (const p of list) {
        console.log(p.name);
      }
      if (list.length === 0) console.log("(no members)");
    }));
}
