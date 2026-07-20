// Shared client bootstrap for CLI commands that require auth.
//
// Extracts the `requireConfig() + new ClubClient(cfg)` pattern that was
// duplicated across ~15 command action handlers. Using a single factory keeps
// client construction in one place and makes future changes (logging,
// per-command options, etc.) a single edit.

import type { Command } from "commander";

import { ClubClient } from "@club/sdk";

import { withCatchExit } from "./catch-exit.js";
import type { ClubConfig } from "./config.js";
import { requireConfig } from "./config.js";

/**
 * Wrap an action so it receives a ready `ClubClient` **and** the current config
 * instead of building them from `requireConfig()` inline.
 *
 * Commander invokes action handlers with `this` bound to the command; the
 * wrapped handler receives `(cfg, args, client)` where `args` is the spread of
 * commander's parsed arguments/options, exactly as the original handler saw
 * them. `cfg` is the parsed `ClubConfig` (single source of truth — the factory
 * calls `requireConfig()` once so commands don't need to). `client` is a
 * freshly-constructed `ClubClient`. The whole thing is still guarded by
 * `withCatchExit`, so handler errors get the same "error: <msg>" treatment as
 * before.
 *
 * NOTE: the generic is constrained to a mutable array (`unknown[]`) so the
 * rest-params on the returned Commander action are compatible with the mutable
 * `args` Commander passes at call time. The handler receives `args` as a
 * `readonly` tuple so the function signature accepts both mutable and readonly
 * input.
 */
export function withAuthClient<T extends unknown[]>(
  fn: (cfg: ClubConfig, args: readonly [...T], client: ClubClient) => void | Promise<void>,
): (this: Command, ...args: T) => Promise<void> {
  // Commander always calls action handlers with `this` bound to the `Command`
  // instance. We preserve that binding for the downstream `withCatchExit`
  // wrapper (which also needs the correct `this` to forward). Using a plain
  // function expression rather than an arrow lets TypeScript treat `this:
  // Command` as the actual `this` annotation instead of a first positional
  // parameter — the previous arrow-shape with an explicit `_this: Command`
  // argument confused inference and made downstream `args` drift out of sync.
  return withCatchExit(function (this: Command, ...args: T) {
    const cfg = requireConfig();
    const client = new ClubClient(cfg);
    return fn(cfg, args as unknown as readonly [...T], client);
  });
}
