import { createMiddleware } from "hono/factory";
import type { Participant } from "@club/shared";
import { parseBearer } from "@club/shared";
import { getParticipantByKeyHash } from "./db.js";
import { hashKey } from "./crypto.js";
import { jsonErr } from "./lib.js";

export { hashKey };

declare module "hono" {
  interface ContextVariableMap {
    participant: Participant;
  }
}

// parseBearer() lives in @club/shared (pure + unit-tested there and re-exported
// from ./lib.ts for backward compatibility).

export const requireAuth = createMiddleware(async (c, next) => {
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