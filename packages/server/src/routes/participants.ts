import { randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { ulid } from "ulid";
import {
  CreateParticipantRequest,
  RecoverParticipantRequest,
  type Participant,
  type ParticipantKind,
} from "@club/shared";
import {
  getParticipantForRecover,
  getParticipantByName,
  insertParticipant,
  updateParticipantKey,
  updateParticipantRecover,
} from "../db.js";
import { hashKey } from "../crypto.js";

export const participants = new Hono();

// Generate a single-use key. Plaintext returned exactly once. The kind is
// embedded in the prefix (club_human_…/club_agent_…) as a display hint only.
function newKey(kind: ParticipantKind): string {
  const token = randomBytes(24).toString("base64url");
  return `club_${kind}_${token}`;
}

// A one-time recovery code: same entropy source as the key, but a distinct
// prefix so the two are never confusable. Plaintext returned exactly once.
function newRecoverCode(): string {
  const token = randomBytes(24).toString("base64url");
  return `club_recover_${token}`;
}

// Constant-time equality of two hex sha256 digests. Both inputs are expected to
// be 64-char hex strings; if lengths differ we still do a same-length compare
// against a zero buffer to keep timing uniform (matches the "uniform 401"
// anti-enumeration stance in the PRD §6.4).
function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}

// POST /participants  { name, kind } -> { key, recoverCode, participant }
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
  const recoverCode = newRecoverCode();
  insertParticipant(id, name, kind, hashKey(plaintext), hashKey(recoverCode), Date.now());
  const participant: Participant = {
    id,
    name,
    kind,
    createdAt: Date.now(),
  };
  return c.json({ key: plaintext, recoverCode, participant }, 201);
});

// POST /participants/recover  { name, recoverCode }
//   -> { key, recoverCode, participant }   (reissued key + fresh recovery code)
//
// Fails with a uniform 401 whether the name is unknown or the code is wrong,
// so the endpoint cannot be used to enumerate callsigns (PRD AC7 / §6.4).
// On success the recovery code is single-use: it is rotated to a brand-new one
// (PRD §5.4 / §8.1 "换发新恢复码"), keeping each participant always armed with
// exactly one active recovery code.
participants.post("/recover", async (c) => {
  const parsed = RecoverParticipantRequest.safeParse(
    await c.req.json().catch(() => ({})),
  );
  if (!parsed.success) {
    // Validation failure leaks nothing about name existence; treat as bad
    // shape and return 400 with the generic message.
    return c.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, 400);
  }
  const { name, recoverCode } = parsed.data;
  const row = getParticipantForRecover(name);

  // Reject (uniformly) when the name is unknown OR no recovery code is armed
  // OR the code doesn't match. Constant-time compare when there is a hash to
  // compare against; the missing-name and missing-hash branches are folded
  // into the same 401 so they are indistinguishable to a caller.
  const matches =
    !!row &&
    !!row.recover_hash &&
    safeEqualHex(hashKey(recoverCode), row.recover_hash);
  if (!matches) {
    return c.json({ error: "invalid recovery code" }, 401);
  }

  // Reissue both credentials, reusing the original id + name.
  const newPlainKey = newKey(row.kind);
  const newCode = newRecoverCode();
  updateParticipantKey(row.id, hashKey(newPlainKey));
  updateParticipantRecover(row.id, hashKey(newCode));

  const participant: Participant = {
    id: row.id,
    name: row.name,
    kind: row.kind,
    createdAt: row.created_at,
  };
  return c.json({ key: newPlainKey, recoverCode: newCode, participant }, 200);
});
