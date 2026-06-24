import { Command } from "commander";
import { saveConfig } from "../config.js";

export function makeLoginCommand(): Command {
  return new Command("login")
    .description("store your key and server address")
    .argument("<key>", "the key issued at /participants")
    .option("-s, --server <url>", "server base url", "http://localhost:3000")
    .action((key: string, opts: { server: string }) => {
      const server = opts.server.replace(/\/$/, "");
      saveConfig({ server, key });
      console.log(`saved. server=${server}`);
      console.log(`try: club whoami`);
    });
}