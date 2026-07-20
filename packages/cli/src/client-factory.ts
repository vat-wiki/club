// Shared client bootstrap for CLI commands that require auth.
//
// Extracts the `requireConfig() + new ClubClient(cfg)` pattern that was
// duplicated across ~15 command action handlers. Using a single factory keeps
// client construction in one place and makes future changes (logging,
// per-command options, etc.) a single edit.

import type { Command } from "commander";
import { ClubClient } from "@club/sdk";
import { requireConfig } from "./config.js";
import { withCatchExit } from "./catch-exit.js";

/**
 * Wrap an action so it receives a ready `ClubClient` instead of building one
 * from `requireConfig()` inline.
 *
 * Commander invokes action handlers with `this` bound to the command; the
 * wrapped handler receives `(args, client)` where `args` is the spread of
 * commander's parsed arguments/options, exactly as the original handler saw
 * them. `client` is a freshly-constructed `ClubClient` using the config on
 * disk. The whole thing is still guarded by `withCatchExit`, so handler
 * errors get the same "error: <msg>" treatment as before.
 */
export function withAuthClient<T extends readonly unknown[]>(
  fn: (args: T, client: ClubClient) => void | Promise<void>,
): (this: Command, ...args: T) => Promise<void> {
  return withCatchExit(async (_this: Command, ...args: T) => {
    const cfg = requireConfig();
    const client = new ClubClient(cfg);
    return fn(args, client);
  });
}
