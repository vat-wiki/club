// club rotate-key
//
// Rotate the current participant's key. The server requires the key you
// authenticated with as the "password" (proof you still hold the current
// credential); it returns a fresh key + a fresh recovery code, invalidating
// the old key. We persist the new key to config (so subsequent club commands
// stay authenticated) and print the new recovery code ONCE with a "save it"
// warning - it is unrecoverable after this.
//
// Mirrors recover.ts/login.ts for the config-save pattern; no args needed
// (uses the config key + me() to resolve the participant id).

import { Command } from "commander";

import { ClubClient } from "@club/sdk";
import type { Participant } from "@club/shared";

import { withCatchExit } from "../catch-exit.js";
import { requireConfig, saveConfig } from "../config.js";

/** Shape returned by `client.rotateKey(id, password)`. */
export interface RotateKeyResult {
  key: string;
  recoverCode: string;
}

/** Persisted config shape; matches what saveConfig expects. */
export interface RotateKeyConfig {
  server: string;
  key: string;
}

/** Inputs after commander parsing (resolved from config by the action). */
export interface RotateKeyInput {
  /** The current key, sent to the server as the password. */
  currentKey: string;
  /** Server url, kept verbatim when re-saving config with the new key. */
  server: string;
}

/** Dependency shape for `runRotateKey`, injected by the CLI action or tests. */
export interface RotateKeyDeps {
  /** GET /me - the authenticated participant (we need its id). */
  me: () => Promise<Participant>;
  /** Simulate `ClubClient.rotateKey(id, password)`. */
  rotateKey: (id: string, password: string) => Promise<RotateKeyResult>;
  /** Persist the updated `{ server, key }` to config. */
  saveConfig: (cfg: RotateKeyConfig) => void;
}

/**
 * Rotate the current key and persist the new one.
 *
 * The current key (from config) is the "password" the server verifies; on
 * success we overwrite config.key with the freshly issued key and print the
 * new recovery code once. Throws on API failure so the caller surfaces it.
 */
export async function runRotateKey(
  input: RotateKeyInput,
  deps: RotateKeyDeps,
): Promise<void> {
  const me = await deps.me();
  const res = await deps.rotateKey(me.id, input.currentKey);
  deps.saveConfig({ server: input.server, key: res.key });
  console.log(`rotated key for ${me.name} (id=${me.id}).`);
  console.log(`new key saved to config.`);
  console.log(`new recovery code (save it - the old one is now invalid):`);
  console.log(`  ${res.recoverCode}`);
  console.log(`try: club whoami`);
}

/**
 * Build the `club rotate-key` commander sub-command.
 *
 * Rotates the current key: the config key is sent as the password, the server
 * returns a fresh key + recovery code, and the new key is written to config.
 * No arguments - everything is resolved from the existing config + `me()`.
 *
 * @returns A configured `Command` instance to register with the CLI program.
 */
export function makeRotateKeyCommand(): Command {
  return new Command("rotate-key")
    .description("rotate your key (current key + me(); saves the new key to config)")
    .action(withCatchExit(async () => {
      const cfg = requireConfig();
      const client = new ClubClient(cfg);
      return runRotateKey(
        { currentKey: cfg.key, server: cfg.server },
        {
          me: () => client.me(),
          rotateKey: (id, password) => client.rotateKey(id, password),
          saveConfig,
        },
      );
    }));
}
