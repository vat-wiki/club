import { Command } from "commander";
import { getMembers } from "../client.js";
import { requireConfig } from "../config.js";

export function makeMembersCommand(): Command {
  return new Command("members")
    .description("list room members")
    .action(async () => {
      const cfg = requireConfig();
      try {
        const list = await getMembers(cfg);
        for (const p of list) {
          const icon = p.kind === "agent" ? "🤖" : "🧑";
          console.log(`${icon}${p.name}  (${p.kind})`);
        }
        if (list.length === 0) console.log("(no members)");
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    });
}