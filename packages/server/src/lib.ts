/**
 * Parse and clamp a `limit` query-param into the supported [1, 500] range.
 *
 * Pure and unit-tested. Replaces an inline expression in routes/messages.ts
 * that had no lower bound: a negative value (e.g. ?limit=-1) was passed
 * straight to SQLite, which treats a negative LIMIT as *no* limit — so one
 * request could return the entire messages table. Anything that isn't a
 * positive finite number now falls back to the default.
 */
export function parseLimit(raw: string | number | undefined, fallback = 100): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.max(1, Math.floor(n)), 500);
}

/**
 * Extract a bearer token from an Authorization header value.
 *
 * Accepts "Bearer <token>" case-insensitively, tolerates extra/leading spaces,
 * trims the token, and returns undefined for anything that isn't a Bearer
 * scheme (missing/empty header, "Basic ...", "Bearer" with no token). Pure and
 * unit-tested; extracted from auth.ts so it can be tested without pulling in
 * the SQLite connection that auth.ts wires up at import time.
 */
export function parseBearer(auth: string | undefined): string | undefined {
  if (!auth) return undefined;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : undefined;
}
