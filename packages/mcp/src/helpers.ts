// Pure input-coercion helpers used by the MCP tool dispatcher.
//
// Kept side-effect-free and in their own module so they can be unit-tested in
// isolation: the server entry (index.ts) has top-level stdio side effects
// (resolveConn → process.exit, server.connect) that make importing it directly
// impractical from a test.

/** Coerce an MCP tool argument to a string ("" if absent or not a string). */
export function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Coerce an MCP tool argument to a number, or undefined if not a number.
 * NOTE: intentionally passes NaN/±Infinity through unchanged — the `?? default`
 * at call sites only catches null/undefined, matching the original behavior.
 */
export function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

/**
 * Clamp a `limit` tool argument into the supported [1, 500] range.
 * Non-numbers and non-finite numbers (NaN / ±Infinity) fall back to the
 * default of 50, so a malformed argument can never yield NaN/Infinity.
 */
export function clampLimit(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 50;
  return Math.min(Math.max(1, Math.floor(n)), 500);
}

/**
 * Does `content` contain a @mention of `mention`?
 *
 * Mirrors the CLI `listen --mention` rule so a CLI agent and an MCP agent wake
 * on the same triggers: case-insensitive substring match on "@<name>". A
 * missing/empty `mention` matches every message (the `listen` "no filter" path).
 *
 * Pure + unit-tested; extracted from runListen so the matching rule — including
 * its intentional substring precision — is explicit and pinned by tests.
 */
export function matchesMention(
  content: string,
  mention: string | null | undefined,
): boolean {
  if (!mention) return true;
  return content.toLowerCase().includes("@" + mention.toLowerCase());
}
