import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { parseQueryLimit, ROOM_SLUG_REGEX, isValidId } from "@club/shared";

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
  status: ContentfulStatusCode | number = 400,
) {
  return c.json({ error: message }, status as ContentfulStatusCode);
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

/**
 * Parse a JSON request body through a Zod schema in one shot.
 *
 * Handles the common three-step pattern seen in every JSON-accepting route:
 * parse the body, run Zod `safeParse`, and return a `jsonErr` response on
 * either a parse failure or schema rejection. Callers get the typed payload
 * on success, or a `{ ok: false }` marker on failure.
 *
 * JSON parse errors (malformed body, wrong Content-Type, truncated payload)
 * are returned as an explicit parse-error response so clients and audit logs
 * distinguish a truly empty `{}` body from a broken request. This avoids
 * silently coercing garbage payloads into `{}`, which could bypass required-
 * field validation or mask client bugs.
 *
 * @example
 * ```ts
 * const parsed = await parseJsonBody(c, CreateMessageRequest, "bad request");
 * if (!parsed.ok) return parsed.r;
 * const { content, attachmentIds } = parsed.data;
 * ```
 *
 * @returns On success `{ ok: true, data: T }`; on failure
 * `{ ok: false, r: Response }` to use as an early-return from the route handler.
 *
 * @typeParam T - The output type of the Zod schema.
 * @param c - The Hono request context.
 * @param schema - Any Zod-like schema exposing `safeParse(input): { success: boolean; data?: unknown }`.
 * @param errorMessage - The error message to include on schema rejection.
 * @param status - HTTP status for the error response (defaults to 400).
 */
export async function parseJsonBody<T>(
  c: Context,
  schema: { safeParse(input: unknown): { success: boolean; data?: unknown } },
  errorMessage: string,
  status: ContentfulStatusCode = 400,
): Promise<
  | { ok: true; data: T }
  | { ok: false; r: Response }
> {
  // Parse the body explicitly; reject malformed JSON with a distinct message
  // rather than silently coercing to {} (which could bypass required-field
  // validation and masks broken requests in audit logs).
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { ok: false, r: jsonErr(c, "invalid JSON", status) };
  }
  const parsed = schema.safeParse(body) as { success: boolean; data?: T };
  if (!parsed.success || parsed.data === undefined) {
    return { ok: false, r: jsonErr(c, errorMessage, status) };
  }
  return { ok: true, data: parsed.data };
}

export { parseBearer } from "@club/shared";

/**
 * Reject a request with a 400 error when the id param fails format validation.
 *
 * Ids (ULIDs / base64url slugs) must be a safe token with no whitespace,
 * path separators, or traversal sequences. Invalid ids are rejected before
 * any DB or filesystem call so bogus input never reaches a prepared statement
 * or the `filePath()` guard.
 *
 * @param c - The Hono request context.
 * @param id - The id parameter to validate.
 * @param kind - Human-readable noun for the error message (e.g. "message id").
 * @returns A response on invalid input, or `undefined` when the id is valid.
 */
export function requireValidId(
  c: Context,
  id: string,
  kind: string,
): { ok: false; r: Response } | undefined {
  if (!id || !isValidId(id)) {
    return { ok: false, r: jsonErr(c, `bad ${kind}`) };
  }
  return undefined;
}

/**
 * Validate a room slug against the canonical `ROOM_SLUG_REGEX`.
 *
 * Pure (no Hono Context) so the check can be unit-tested in isolation.
 */
export function isValidRoomSlug(slug: string): boolean {
  return ROOM_SLUG_REGEX.test(slug);
}

/**
 * Reject a request with a 400 error when the room slug is invalid.
 *
 * A room slug MUST match `ROOM_SLUG_REGEX` (`^[a-z0-9][a-z0-9-]{0,29}$`)
 * — the same contract that POST /rooms enforces. Arbitrary query-param values
 * must be rejected rather than passed through, because room slugs end up in
 * SSE `room` fan-out and untrusted characters (notably newlines) enable CRLF
 * injection into the SSE wire format.
 */
export function requireValidRoomSlug(
  c: Context,
  slug: string,
): { ok: false; r: Response } | undefined {
  if (!isValidRoomSlug(slug)) {
    return { ok: false, r: jsonErr(c, "bad room slug") };
  }
  return undefined;
}
