// Pure parser for the `read` command's `--limit` option.
//
// commander hands options to actions as strings (the `--limit <n>` default is
// "50"). The old call site did `Number(opts.limit) || 50`, which only rejects
// 0 and NaN: a negative like `--limit -5` is truthy and leaked straight to the
// server, which then *silently* clamped it (to its own default) — so the CLI's
// behavior depended on opaque server-side clamping the user couldn't predict.
//
// This mirrors the server's `parseLimit` and the MCP client's `clampLimit`:
// every client clamps into [1, 500] itself, defaulting to 50, so they agree on
// a sensible count instead of pushing nonsense downstream. Pure + exported so
// the clamping rule is unit-tested in isolation.
export function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 50;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50; // "abc" -> NaN, "Infinity" -> Infinity
  return Math.min(Math.max(1, Math.floor(n)), 500);
}
