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
 *
 * Commander always invokes action handlers with `this` bound to the `Command`
 * instance. Because Commander may bind `this` lazily (before the handler
 * executes), we must avoid an arrow-function wrapper around the handler —
 * arrow functions capture their outer `this` at definition time and ignore
 * Commander's binding, which drops the command context downstream. The inner
 * wrapper therefore uses a plain function expression so `this` resolves to
 * the `Command` at call time; the outer wrapper can safely be async because
 * it captures `this` from the Commander call site before any `await` escapes
 * the scope.
 *
 * @param fn - The action handler, which may be sync or async and may rely
 *             on `this: Command` to inspect flags/options/parents.
 * @returns An async action wrapper that catches rejections from `fn`, formats
 *          them via `formatError`, and exits the process with code 1.
 */
export function withCatchExit<
  T extends unknown[],
  R,
>(
  fn: (this: Command, ...args: T) => R | Promise<R>,
): (this: Command, ...args: T) => Promise<R> {
  // Preserve the Commander `this` at the call site so the inner wrapper can
  // pass it through. We bind `this` immediately before awaiting — the outer
  // wrapper may itself be invoked with a different `this` (e.g. via spread in
  // `client-factory.ts`), but Commander will call it with the right `this`.
  return function (this: Command, ...args: T): Promise<R> {
    const self = this;
    return (async () => {
      try {
        return await Promise.resolve(fn.apply(self, args));
      } catch (err) {
        console.error(`error: ${formatError(err)}`);
        process.exit(1);
      }
    })();
  };
}
