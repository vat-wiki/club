import { Command } from "commander";
import { ClubClient } from "@club/sdk";
import { requireConfig } from "../config.js";
import { withCatchExit } from "../catch-exit.js";

export function makeMembersCommand(): Command {
  return new Command("members")
    .description("list room members")
    .action(withCatchExit(async () => {
      const cfg = requireConfig();
      const list = await new ClubClient(cfg).members();
      for (const p of list) {
        console.log(p.name);
      }
      if (list.length === 0) console.log("(no members)");
    }));
}