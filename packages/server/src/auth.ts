import { createMiddleware } from "hono/factory";
import type { Participant, ParticipantKind } from "@club/shared";
import { getParticipantByKeyHash } from "./db.js";
import { hashKey } from "./crypto.js";

export { hashKey };

declare module "hono" {
  interface ContextVariableMap {
    participant: Participant;
  }
}

function parseBearer(auth: string | undefined): string | undefined {
  if (!auth) return undefined;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : undefined;
}

export const requireAuth = createMiddleware(async (c, next) => {
  const key = parseBearer(c.req.header("Authorization"));
  if (!key) return c.json({ error: "missing bearer token" }, 401);
  const row = getParticipantByKeyHash(hashKey(key));
  if (!row) return c.json({ error: "invalid key" }, 401);
  c.set("participant", {
    id: row.id,
    name: row.name,
    kind: row.kind as ParticipantKind,
    createdAt: row.created_at,
  });
  await next();
});