import { Command } from "commander";
import { ClubClient, formatError } from "@club/sdk";
import { requireConfig } from "../config.js";

export function makeMembersCommand(): Command {
  return new Command("members")
    .description("list room members")
    .action(async () => {
      const cfg = requireConfig();
      try {
        const list = await new ClubClient(cfg).members();
        for (const p of list) {
          console.log(p.name);
        }
        if (list.length === 0) console.log("(no members)");
      } catch (err) {
        console.error(formatError(err));
        process.exit(1);
      }
    });
}