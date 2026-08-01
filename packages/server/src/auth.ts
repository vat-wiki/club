import { createMiddleware } from "hono/factory";

import type { Participant } from "@club/shared";
import { parseBearer } from "@club/shared";

import { hashKey } from "./crypto.js";
import { getParticipantByKeyHash } from "./db.js";
import { checkKeyRateLimit,KEY_RATE_MAX, KEY_RATE_WINDOW_MS } from "./key-rate-limit.js";
import { jsonErr } from "./lib.js";

/**
 * Re-export of `hashKey` from `./crypto.ts`. Provided here so middleware
 * callers and tests can patch the hashing side without importing the crypto
 * module directly (kept for backward compatibility).
 */
export { hashKey };

/**
 * Re-export of the per-key rate limit constants so callers (notably tests)
 * can assert the contract without importing `./key-rate-limit.ts` directly.
 */
export { KEY_RATE_MAX, KEY_RATE_WINDOW_MS };

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
 * **Per-key rate limiting (defense-in-depth):** after the header is parsed but
 * *before* the DB lookup, the middleware enforces a per-key fixed-window limit
 * (default 30 requests per minute) via `checkKeyRateLimit`. A valid key that
 * fires rapidly from many IPs is almost certainly compromised; the global
 * per-IP rate limiter (`rate-limit.ts`) cannot catch cross-IP replay of a
 * leaked credential. The per-key limiter does. The SSE stream endpoint
 * (`GET /messages/stream`) is exempt: its long-lived, reconnect-prone
 * connections would otherwise exhaust the budget and block real sends.
 *
 * The middleware is used as `app.use("/", requireAuth)` in every route module
 * (participants, messages, channels, …), so a single change here propagates to
 * every protected endpoint.
 *
 * @see parseBearer (in `@club/shared`) — pure parsing, unit-tested there.
 * @see getParticipantByKeyHash — DB lookup by SHA-256 of the plaintext key.
 * @see checkKeyRateLimit — per-key fixed-window limiter in `key-rate-limit.ts`.
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

  // Per-key rate limit BEFORE DB lookup: a leaked / forged key must be
  // throttled even if the hash never matches a row. This is a defence-
  // in-depth cap — the global per-IP limiter covers direct attacks, this
  // one covers cross-IP replay of a compromised credential.
  // Disabled in test mode (NODE_ENV=test) so suites that fire dozens of
  // authenticated requests in a single minute don't trip the 30/min ceiling;
  // mirrors the isTest gating in the per-IP and write-path limiters.
  // Also exempted for the SSE stream endpoint (GET /messages/stream): each
  // connection is long-lived and reconnects on network jitter / multi-tab
  // usage, so charging 30/min per key would let a few reconnects exhaust the
  // budget and block real sends. The global per-IP limiter still bounds
  // abuse on the stream path.
  const isTest = process.env.NODE_ENV === "test";
  const isSSEStream =
    c.req.method === "GET" && c.req.path.endsWith("/messages/stream");
  const exceeded = isTest || isSSEStream ? null : checkKeyRateLimit(c, key);
  if (exceeded) return jsonErr(c, exceeded.error, exceeded.status as 429);

  const row = getParticipantByKeyHash(hashKey(key));
  if (!row) return jsonErr(c, "invalid key", 401);
  c.set("participant", {
    id: row.id,
    name: row.name,
    bio: row.bio,
    createdAt: row.created_at,
  });
  await next();
});