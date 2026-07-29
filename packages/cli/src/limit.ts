// Re-export of the shared limit parser, kept under the original name
// (`parseLimit`) for the `read` command's import. The CLI and shared package
// share the same clamp semantics ([1, 500], default 50, 0/negatives → 1),
// so this avoids a second copy of the clamping rule.
//
// @see {@link @club/shared#parseFlagLimit}
export { parseFlagLimit as parseLimit } from "@club/shared";
