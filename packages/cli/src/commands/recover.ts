import { Command } from "commander";
import { ClubClient } from "@club/sdk";
import { loadConfig, saveConfig } from "../config.js";
import { withCatchExit } from "../catch-exit.js";

// club recover <name> <code>
// Recovers an existing identity by callsign + one-time recovery code. The
// server reissues a fresh key (and a fresh recovery code), reusing the
// original id + name; the new key is written to config so subsequent club
// commands act as the recovered identity.
//
// Server URL resolution mirrors `club login`: --server flag, else the server
// stored in the existing config, else the local default.
export function makeRecoverCommand(): Command {
  return new Command("recover")
    .description("recover an identity by callsign + recovery code")
    .argument("<name>", "callsign of the identity to recover")
    .argument("<code>", "the one-time recovery code issued at signup")
    .option("-s, --server <url>", "server base url", "http://localhost:6200")
    .action(withCatchExit(async (name: string, code: string, opts: { server: string }) => {
      const existing = loadConfig();
      const server = (existing?.server ?? opts.server).replace(/\/$/, "");
      const client = new ClubClient({ server });
      const res = await client.recoverParticipant({ name, recoverCode: code });
      saveConfig({ server, key: res.key });
      console.log(`recovered. you are now ${res.participant.name} (id=${res.participant.id}).`);
      console.log(`new key saved to config.`);
      console.log(`new recovery code (save it — the old one is now invalid):`);
      console.log(`  ${res.recoverCode}`);
      console.log(`try: club whoami`);
    }));
}
