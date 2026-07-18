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

// parseBearer is now in @club/shared — re-export for backward compat.
export { parseBearer } from "@club/shared";
