import { Command } from "commander";
import { ClubClient } from "@club/sdk";
import { loadConfig, saveConfig } from "../config.js";

// club recover <name> <code>
// Recovers an existing identity by callsign + one-time recovery code. The
// server reissues a fresh key (and a fresh recovery code), reusing the
// original id + name; the new key is written to config so subsequent club
// commands act as the recovered identity. The new recovery code is printed to
// the terminal and must be saved again (the old one is now invalid).
//
// Server URL resolution mirrors `club login`: --server flag, else the server
// stored in the existing config (so a user can recover even with no config
// yet by passing --server), else the local default.
export function makeRecoverCommand(): Command {
  return new Command("recover")
    .description("recover an identity by callsign + recovery code")
    .argument("<name>", "callsign of the identity to recover")
    .argument("<code>", "the one-time recovery code issued at signup")
    .option("-s, --server <url>", "server base url", "http://localhost:6200")
    .action(async (name: string, code: string, opts: { server: string }) => {
      // Prefer the existing config's server when one is present (recover is
      // most often run by someone who already used club on this machine); fall
      // back to the flag/default otherwise.
      const existing = loadConfig();
      const server = (existing?.server ?? opts.server).replace(/\/$/, "");
      const client = new ClubClient({ server });
      try {
        const res = await client.recoverParticipant({ name, recoverCode: code });
        saveConfig({ server, key: res.key });
        console.log(`recovered. you are now ${res.participant.name} (id=${res.participant.id}).`);
        console.log(`new key saved to config.`);
        console.log(`new recovery code (save it — the old one is now invalid):`);
        console.log(`  ${res.recoverCode}`);
        console.log(`try: club whoami`);
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    });
}
