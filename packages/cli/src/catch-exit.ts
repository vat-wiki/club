// Reusable wrapper: run an async command handler, and on rejection format the
// error through the shared SDK `formatError` helper (consistent with
// `formatError` already used by `whoami`, `info`, `cat`, etc.) and exit 1.
//
// Commander's `parseAsync().catch(...)` in index.ts handles rejections at the
// very top level, but its `die()` formatter assumes `err.message` exists. The
// SDK can throw `ClubApiError` (no `.message` property) or string errors;
// `formatError` handles all three shapes. Wrapping at the command boundary
// avoids leaking a stack trace to the user and keeps every command's error
// output identical.

import { formatError } from "@club/sdk";
import type { Command } from "commander";

/**
 * Wrap an async Commander `.action` callback so that errors are surfaced via
 * `formatError` and the process exits with code 1. Pure wrapper — no
 * retry, no side effects.
 */
export function withCatchExit<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
): (...args: T) => Promise<R> {
  return async (...args: T) => {
    try {
      return await fn(...args);
    } catch (err) {
      console.error(formatError(err));
      process.exit(1);
    }
  };
}
