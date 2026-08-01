// club delete-account <recoverCode> [--yes]
//
// Self-delete the current participant's account. Two-factor: the current key
// (from config, sent as `password`) PLUS the one-time recovery code (arg).
// Mirrors kick's directness but adds a `--yes` gate because, unlike kick,
// this wipes YOUR OWN identity + stored key - an irreversible footgun we
// refuse to run without an explicit ack. On success the config file is
// cleared (the account is gone, so the key is worthless and would only 401
// on every subsequent command).

import { Command } from "commander";

import { ClubClient } from "@club/sdk";
import type { Participant } from "@club/shared";

import { withCatchExit } from "../catch-exit.js";
import { clearConfig, requireConfig } from "../config.js";

export interface DeleteAccountDeps {
  /** GET /me - the authenticated participant (we need its id). */
  me: () => Promise<Participant>;
  /** Simulate `ClubClient.deleteAccount(id, { password, recoverCode })`. */
  deleteAccount: (id: string, input: { password: string; recoverCode: string }) => Promise<void>;
  /** Remove the config file (log out). No-op when already absent. */
  clearConfig: () => void;
}

export interface DeleteAccountInput {
  /** Recovery code (second factor); required. */
  recoverCode: string;
  /** Current key from config, sent as `password`. */
  currentKey: string;
  /** Explicit confirmation gate; the command refuses without it. */
  yes: boolean;
}

/**
 * Self-delete the account and clear the stored config.
 *
 * Refuses without `yes` (an irreversible op shouldn't fire from a typo). The
 * recovery code is the second factor; the current key is the first. On
 * success the config is cleared so subsequent commands prompt for login.
 * Throws on API failure so the caller surfaces it; the config is left intact
 * when delete fails (the account still exists, the key still works).
 */
export async function runDeleteAccount(
  input: DeleteAccountInput,
  deps: DeleteAccountDeps,
): Promise<void> {
  if (!input.yes) {
    throw new Error(
      "this permanently deletes your account. re-run with --yes to confirm.",
    );
  }
  const me = await deps.me();
  await deps.deleteAccount(me.id, {
    password: input.currentKey,
    recoverCode: input.recoverCode,
  });
  deps.clearConfig();
  console.log(`deleted account ${me.name} (id=${me.id}). config cleared - you are logged out.`);
}

/**
 * Build the `club delete-account` commander sub-command.
 *
 * Self-deletes the current account (two-factor: current key from config +
 * recovery code arg). Irreversible, so `--yes` is required to proceed; on
 * success the config file is removed. No `--server` flag - the server is
 * always the one in config (you must already be logged in).
 *
 * @returns A configured `Command` instance to register with the CLI program.
 */
export function makeDeleteAccountCommand(): Command {
  return new Command("delete-account")
    .description("permanently delete your own account (current key + recovery code; --yes to confirm)")
    .argument("<recoverCode>", "your one-time recovery code (second factor)")
    .option("--yes", "confirm the irreversible deletion (required)")
    .action(
      withCatchExit(async (recoverCode: string, opts: { yes?: boolean }) => {
        const cfg = requireConfig();
        const client = new ClubClient(cfg);
        return runDeleteAccount(
          { recoverCode, currentKey: cfg.key, yes: opts.yes === true },
          {
            me: () => client.me(),
            deleteAccount: (id, input) => client.deleteAccount(id, input),
            clearConfig,
          },
        );
      }),
    );
}
