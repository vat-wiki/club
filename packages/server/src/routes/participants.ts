import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { ulid } from "ulid";
import {
  CreateParticipantRequest,
  type Participant,
  type ParticipantKind,
} from "@club/shared";
import { getParticipantByName, insertParticipant } from "../db.js";
import { hashKey } from "../crypto.js";

export const participants = new Hono();

// Generate a single-use key. Plaintext returned exactly once.
function newKey(kind: ParticipantKind): string {
  const token = randomBytes(24).toString("base64url");
  return `club_${kind}_${token}`;
}

// POST /participants  { name, kind } -> { key, participant }
participants.post("/", async (c) => {
  const parsed = CreateParticipantRequest.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, 400);
  }
  const { name, kind } = parsed.data;
  if (getParticipantByName(name)) {
    return c.json({ error: `name "${name}" is taken` }, 409);
  }
  const id = ulid();
  const plaintext = newKey(kind);
  insertParticipant(id, name, kind, hashKey(plaintext), Date.now());
  const participant: Participant = {
    id,
    name,
    kind,
    createdAt: Date.now(),
  };
  return c.json({ key: plaintext, participant }, 201);
});