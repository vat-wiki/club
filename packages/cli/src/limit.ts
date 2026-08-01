// Re-export of the shared limit parser, kept under the original name
// (`parseLimit`) for the `read` command's import. The CLI and shared package
// share the same clamp semantics ([1, 500], 0/negatives -> 1), so this avoids
// a second copy of the clamping rule.
//
// Default note: the effective `club read` default is 20, set by commander's
// `--limit` option default ("20") in read.ts. `parseFlagLimit` itself falls
// back to 50 only when called with undefined/empty - a path the CLI never
// takes, since commander always supplies the "20" default. Don't read the 50
// here as the user-facing default; it's the shared helper's own fallback.
//
// @see {@link @club/shared#parseFlagLimit}
export { parseFlagLimit as parseLimit } from "@club/shared";
