import { Command } from "commander";
import { ClubClient } from "@club/sdk";
import { requireConfig } from "../config.js";
import { withCatchExit } from "../catch-exit.js";

export function makeWhoamiCommand(): Command {
  return new Command("whoami")
    .description("show who you are logged in as")
    .action(withCatchExit(async () => {
      const cfg = requireConfig();
      const me = await new ClubClient(cfg).me();
      console.log(`${me.name}  id=${me.id}`);
    }));
}