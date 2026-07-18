import { Command } from "commander";
import { ClubClient, formatError } from "@club/sdk";
import { requireConfig } from "../config.js";

export function makeWhoamiCommand(): Command {
  return new Command("whoami")
    .description("show who you are logged in as")
    .action(async () => {
      const cfg = requireConfig();
      try {
        const me = await new ClubClient(cfg).me();
        console.log(`${me.name}  id=${me.id}`);
      } catch (err) {
        console.error(formatError(err));
        process.exit(1);
      }
    });
}