// Reusable wrapper: run a sync or async Commander command handler, and on
// rejection format the error through the shared SDK `formatError` helper
// (consistent with `formatError` already used by `whoami`, `info`, `cat`, etc.)
// and exit 1.
//
// Commander's `parseAsync().catch(...)` in index.ts handles rejections at the
// very top level, but its `die()` formatter assumes `err.message` exists. The
// SDK can throw `ClubApiError` (no `.message` property) or string errors;
// `formatError` handles all three shapes. Wrapping at the command boundary
// avoids leaking a stack trace to the user and keeps every command's error
// output identical.
//
// The wrapper accepts both sync and async handlers — if the handler returns
// a plain value it is resolved into a promise and then caught. This lets CLI
// commands omit `async` when they have no `await`, eliminating the
// `@typescript-eslint/require-await` lint noise while keeping the error
// contract identical across all commands.

import type { Command } from "commander";
import { formatError } from "@club/sdk";

/**
 * Wrap a Commander `.action` callback (sync or async) so that errors are
 * surfaced via `formatError` and the process exits with code 1. Pure wrapper
 * — no retry, no side effects.
 */
export function withCatchExit<
  T extends unknown[],
  R,
>(
  fn: (this: Command, ...args: T) => R | Promise<R>,
): (this: Command, ...args: T) => Promise<R> {
  return async (this: Command, ...args: T) => {
    try {
      return await Promise.resolve(fn(...args));
    } catch (err) {
      console.error(`error: ${formatError(err)}`);
      process.exit(1);
    }
  };
}
