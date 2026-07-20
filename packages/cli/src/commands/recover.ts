// club recover <name> <code>
//
// Recovers an existing identity by callsign + one-time recovery code. The
// server reissues a fresh key (and a fresh recovery code), reusing the
// original id + name; the new key is written to config so subsequent club
// commands act as the recovered identity.
//
// Server URL resolution mirrors `club login`: --server flag, else the server
// stored in the existing config, else the local default.

import { Command } from "commander";

import { ClubClient } from "@club/sdk";

import { withCatchExit } from "../catch-exit.js";
import { loadConfig, saveConfig } from "../config.js";

/** Persisted config shape; matches what saveConfig expects. */
export interface RecoverConfig {
  server: string;
  key: string;
}

/** Inputs after commander has parsed the CLI args and resolved --server. */
export interface RecoverInput {
  name: string;
  recoverCode: string;
  /** Server url, already stripped of trailing slash. */
  server: string;
}

/** Shape the recover API returns. */
export interface RecoverResult {
  key: string;
  participant: { name: string; id: string };
  recoverCode: string;
}

/** Dependency shape for `runRecover`, injected by the CLI action or by tests. */
export interface RecoverDeps {
  /** Simulate `ClubClient.recoverParticipant(input)`. */
  recoverParticipant: (input: { name: string; recoverCode: string }) => Promise<RecoverResult>;
  /** Persist the updated `{ server, key }` to config. */
  saveConfig: (cfg: RecoverConfig) => void;
}

/**
 * Recover an identity and persist the new key + server.
 *
 * Throws on API failure so the caller (CLI action) can surface the message.
 */
export async function runRecover(input: RecoverInput, deps: RecoverDeps): Promise<void> {
  const res = await deps.recoverParticipant({
    name: input.name.trim(),
    recoverCode: input.recoverCode,
  });
  deps.saveConfig({ server: input.server, key: res.key });
  console.log(`recovered. you are now ${res.participant.name} (id=${res.participant.id}).`);
  console.log(`new key saved to config.`);
  console.log(`new recovery code (save it — the old one is now invalid):`);
  console.log(`  ${res.recoverCode}`);
  console.log(`try: club whoami`);
}

/**
 * Build the `club recover` commander sub-command.
 *
 * Recovers an existing identity by callsign + one-time recovery code. The
 * server reissues a fresh key (and a fresh recovery code), reusing the original
 * id + name; the new key is written to config so subsequent `club` commands act
 * as the recovered identity. Server URL resolution mirrors `club login`.
 *
 * @returns A configured `Command` instance to register with the CLI program.
 */
export function makeRecoverCommand(): Command {
  return new Command("recover")
    .description("recover an identity by callsign + recovery code")
    .argument("<name>", "callsign of the identity to recover")
    .argument("<code>", "the one-time recovery code issued at signup")
    .option("-s, --server <url>", "server base url", "http://localhost:6200")
    .action(
      withCatchExit(async (name: string, code: string, opts: { server: string }) => {
        const existing = loadConfig();
        const server = (existing?.server ?? opts.server).replace(/\/$/, "");
        const client = new ClubClient({ server });
        return runRecover(
          { name, recoverCode: code, server },
          {
            recoverParticipant: (i) => client.recoverParticipant(i),
            saveConfig,
          },
        );
      }),
    );
}
