import { createMiddleware } from "hono/factory";
import type { Participant } from "@club/shared";
import { parseBearer } from "@club/shared";
import { getParticipantByKeyHash } from "./db.js";
import { hashKey } from "./crypto.js";

export { hashKey };

declare module "hono" {
  interface ContextVariableMap {
    participant: Participant;
  }
}

// parseBearer() lives in ./lib.ts (pure + unit-tested).

export const requireAuth = createMiddleware(async (c, next) => {
  const key = parseBearer(c.req.header("Authorization"));
  if (!key) {
    // Distinguish missing header from malformed header for better debugging.
    // Both are 401 (authentication required), but the message guides the client.
    const authHeader = c.req.header("Authorization");
    if (!authHeader || authHeader.trim() === "") {
      return c.json({ error: "missing Authorization header" }, 401);
    }
    return c.json({ error: "invalid Authorization format (expected 'Bearer <token>')" }, 401);
  }
  const row = getParticipantByKeyHash(hashKey(key));
  if (!row) return c.json({ error: "invalid key" }, 401);
  c.set("participant", {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  });
  await next();
});