import { createMiddleware } from "hono/factory";
import type { Participant } from "@club/shared";
import { parseBearer } from "@club/shared";
import { getParticipantByKeyHash } from "./db.js";
import { hashKey } from "./crypto.js";
import { jsonErr } from "./lib.js";

/**
 * Re-export of `hashKey` from `./crypto.ts`. Provided here so middleware
 * callers and tests can patch the hashing side without importing the crypto
 * module directly (kept for backward compatibility).
 */
export { hashKey };

declare module "hono" {
  interface ContextVariableMap {
    participant: Participant;
  }
}

/**
 * Hono middleware that authenticates incoming requests via `Authorization: Bearer <token>`.
 *
 * Looks up the SHA-256 hash of the supplied key in the `participants` table.
 * On success the middleware injects a typed `Participant` record into the Hono
 * context (`c.get("participant")`) so route handlers can read the actor without
 * repeating the lookup. On failure it returns a `jsonErr` response (401) with a
 * human-readable reason: missing header, malformed header, or invalid key.
 *
 * The middleware is used as `app.use("/", requireAuth)` in every route module
 * (participants, messages, rooms, …), so a single change here propagates to
 * every protected endpoint.
 *
 * @see parseBearer (in `@club/shared`) — pure parsing, unit-tested there.
 * @see getParticipantByKeyHash — DB lookup by SHA-256 of the plaintext key.
 */
export const requireAuth = createMiddleware(async (c, next) => {
  /**
   * `parseBearer` sits in `@club/shared` (pure + unit-tested there) and is
   * re-exported from `./lib.ts` for backward compatibility.
   */
  const key = parseBearer(c.req.header("Authorization"));
  if (!key) {
    if (!c.req.header("Authorization")?.trim()) {
      return jsonErr(c, "missing Authorization header", 401);
    }
    return jsonErr(c, "invalid Authorization format (expected 'Bearer <token>')", 401);
  }
  const row = getParticipantByKeyHash(hashKey(key));
  if (!row) return jsonErr(c, "invalid key", 401);
  c.set("participant", {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  });
  await next();
});