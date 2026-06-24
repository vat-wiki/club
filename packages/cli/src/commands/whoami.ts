import { Command } from "commander";
import { getMe } from "../client.js";
import { requireConfig } from "../config.js";

export function makeWhoamiCommand(): Command {
  return new Command("whoami")
    .description("show who you are logged in as")
    .action(async () => {
      const cfg = requireConfig();
      try {
        const me = await getMe(cfg);
        console.log(`${me.name}  (${me.kind})  id=${me.id}`);
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    });
}