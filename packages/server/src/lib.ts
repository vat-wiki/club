import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { parseQueryLimit } from "@club/shared";

/**
 * Send a `{ error: message }` JSON response with the given status. Centralises
 * the error-response shape across every route so new callers can't accidentally
 * diverge (different keys, inconsistent spacing around the status literal,
 * etc.).
 *
 * Prefer this over `c.json({ error: msg }, status)` in route handlers.
 *
 * Note: `status` is restricted to `ContentfulStatusCode` so the contract
 * can't accidentally be used with a 204 (which by HTTP must have no body).
 * Use `c.body(null, 204)` for no-content success responses instead.
 */
export function jsonErr(
  c: Context,
  message: string,
  status: ContentfulStatusCode = 400,
) {
  return c.json({ error: message }, status);
}

/**
 * Parse and clamp a `limit` query-param into the supported [1, 500] range.
 *
 * Pure and unit-tested. Re-exports the shared implementation so the server
 * routes (HTTP query-string) stay decoupled from other callers (CLI flag,
 * MCP tool arg) that use sibling helpers in the same module.
 *
 * Replaces an inline expression in routes/messages.ts that had no lower
 * bound: a negative value (e.g. ?limit=-1) was passed straight to SQLite,
 * which treats a negative LIMIT as *no* limit — so one request could return
 * the entire messages table. Anything that isn't a positive finite number
 * now falls back to the default.
 */
export function parseLimit(raw: string | number | undefined, fallback = 100): number {
  return parseQueryLimit(raw, fallback);
}

// parseBearer is now in @club/shared — re-export for backward compat.
export { parseBearer } from "@club/shared";
