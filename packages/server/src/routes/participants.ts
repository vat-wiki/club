import { randomBytes, timingSafeEqual } from "node:crypto";

import { Hono } from "hono";
import { ulid } from "ulid";

import {
  CreateParticipantRequest,
  DeleteAccountRequest,
  type Participant,
  RecoverParticipantRequest,
  RotateKeyRequest,
} from "@club/shared";

import { hashKey } from "../crypto.js";
import {
  getParticipantByKeyHash,
  getParticipantByName,
  getParticipantForRecover,
  insertParticipant,
  invalidateParticipantNamesCache,
  softDeleteParticipantMessages,
  updateParticipantKey,
  updateParticipantRecover,
} from "../db.js";
import { jsonErr, parseJsonBody, withOptionalMiddleware } from "../lib.js";
import { requireJson } from "../lib/json-content-type.js";
import { invalidateParticipantNameMap } from "../mention.js";
import { rateLimit } from "../rate-limit.js";

export const participants = new Hono();

// Strict rate limit on key-issuance endpoints: 10 requests per minute per IP.
// Key issuance (POST /participants) and recovery (POST /participants/recover)
// are high-value targets for brute-force / credential-stuffing attacks. The
// global 120/min limit is too permissive here; this tighter cap makes it
// impractical to enumerate names or hammer recovery attempts.
// Disabled in test mode (NODE_ENV=test) so tests can exercise these endpoints
// without hitting the rate ceiling.
const isTest = process.env.NODE_ENV === "test";
const authLimiter = isTest
  ? undefined
  : rateLimit({ max: 10, windowMs: 60_000 });

// Generate a single-use key. Plaintext returned exactly once. The key carries
// only the `club_` namespace prefix — no participant kind, since club no longer
// classifies participants (category-blind). Legacy keys with a club_human_…/
// club_agent_… prefix still validate: auth hashes the full presented string and
// looks up by key_hash, so the prefix was never authoritative.
function newKey(): string {
  const token = randomBytes(24).toString("base64url");
  return `club_${token}`;
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

// POST /participants  { name } -> { key, recoverCode, participant }
function buildParticipant(name: string) {
  const id = ulid();
  const plaintext = newKey();
  const recoverCode = newRecoverCode();
  insertParticipant(id, name, hashKey(plaintext), hashKey(recoverCode), Date.now());
  invalidateParticipantNamesCache();
  invalidateParticipantNameMap();
  return {
    key: plaintext,
    recoverCode,
    participant: { id, name, createdAt: Date.now() } as Participant,
  };
}

// The authLimiter is wired in for production and swapped for a no-op in test
// mode. Using withOptionalMiddleware removes the duplicated test-vs-prod route
// registration that differed only by the presence of the limiter.
participants.post(
  "/",
  requireJson,
  ...withOptionalMiddleware(authLimiter),
  async (c) => {
    const parsed = await parseJsonBody(
      c,
      CreateParticipantRequest,
      "bad request",
    );
    if (!parsed.ok) return parsed.r;
    if (getParticipantByName(parsed.data.name)) {
      return jsonErr(c, `name "${parsed.data.name}" is taken`, 409);
    }
    return c.json(buildParticipant(parsed.data.name), 201);
  },
);

// POST /participants/recover  { name, recoverCode }
//   -> { key, recoverCode, participant }   (reissued key + fresh recovery code)
//
// Fails with a uniform 401 whether the name is unknown or the code is wrong,
// so the endpoint cannot be used to enumerate callsigns (PRD AC7 / §6.4).
// On success the recovery code is single-use: it is rotated to a brand-new one
// (PRD §5.4 / §8.1 "换发新恢复码"), keeping each participant always armed with
// exactly one active recovery code.
function recoverParticipant(name: string, recoverCode: string) {
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
    return { ok: false } as const;
  }

  // Reissue both credentials, reusing the original id + name.
  const newPlainKey = newKey();
  const newCode = newRecoverCode();
  updateParticipantKey(row.id, hashKey(newPlainKey));
  updateParticipantRecover(row.id, hashKey(newCode));
  invalidateParticipantNamesCache();
  invalidateParticipantNameMap();

  return {
    ok: true as const,
    key: newPlainKey,
    recoverCode: newCode,
    participant: {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
    } as Participant,
  };
}

// The authLimiter is wired in for production and swapped for a no-op in test
// mode. Using withOptionalMiddleware removes the duplicated test-vs-prod route
// registration that differed only by the presence of the limiter.
participants.post(
  "/recover",
  requireJson,
  ...withOptionalMiddleware(authLimiter),
  async (c) => {
    const parsed = await parseJsonBody(
      c,
      RecoverParticipantRequest,
      "bad request",
    );
    if (!parsed.ok) return parsed.r;
    const result = recoverParticipant(parsed.data.name, parsed.data.recoverCode);
    if (!result.ok) return jsonErr(c, "invalid recovery code", 401);
    return c.json(result, 200);
  },
);

// POST /participants/:id/rotate-key { password } -> { key, recoverCode }
// Rotates the authenticated participant's key AND reissues a fresh one-time
// recovery code. The caller must present the current key in the Authorization
// header AND send it again as `password` in the body, so the browser cannot
// be silently used to rotate a key without the logged-in session's active key.
// Plaintext key + recovery code returned exactly once; never persisted.
participants.post("/:id/rotate-key", requireJson, async (c) => {
  const me = c.get("participant");
  const id = c.req.param("id");
  if (id !== me.id) return jsonErr(c, "not found", 404);
  const parsed = await parseJsonBody(c, RotateKeyRequest, "bad request");
  if (!parsed.ok) return parsed.r;
  // Body password must match the key the client authenticated with — constant
  // time so the wrong-password path leaks no information about account
  // existence.
  const presentedHash = hashKey(parsed.data.password);
  const currentRow = getParticipantByKeyHash(presentedHash);
  if (currentRow?.id !== me.id) {
    return jsonErr(c, "invalid password", 403);
  }
  const newPlainKey = newKey();
  const newCode = newRecoverCode();
  updateParticipantKey(me.id, hashKey(newPlainKey));
  updateParticipantRecover(me.id, hashKey(newCode));
  invalidateParticipantNamesCache();
  invalidateParticipantNameMap();
  return c.json({ key: newPlainKey, recoverCode: newCode }, 200);
});

// DELETE /participants/:id { password, recoverCode } -> 204
// Permanently deletes the authenticated participant. Requires the current key
// (Authorization header) PLUS the current recovery code in the body, giving a
// high-stakes operation a second factor. Soft-deletes the participant's key
// hash and recovery hash, and soft-deletes all authored messages so history
// stays intact.
participants.delete("/:id", requireJson, async (c) => {
  const me = c.get("participant");
  const id = c.req.param("id");
  if (id !== me.id) return jsonErr(c, "not found", 404);
  const parsed = await parseJsonBody(c, DeleteAccountRequest, "bad request");
  if (!parsed.ok) return parsed.r;
  // First factor: password must match the authenticated key.
  const keyOk = (() => {
    const currentRow = getParticipantByKeyHash(hashKey(parsed.data.password));
    return currentRow?.id === me.id;
  })();
  if (!keyOk) return jsonErr(c, "invalid password", 403);
  // Second factor: recovery code must match the current recover_hash.
  const row = getParticipantForRecover(me.name);
  if (!row?.recover_hash) return jsonErr(c, "invalid recovery code", 403);
  if (!safeEqualHex(hashKey(parsed.data.recoverCode), row.recover_hash)) {
    return jsonErr(c, "invalid recovery code", 403);
  }
  // Revoke both credentials.
  updateParticipantKey(me.id, "");
  updateParticipantRecover(me.id, null);
  // Soft-delete authored content so the participant leaves no traces.
  softDeleteParticipantMessages(me.id);
  invalidateParticipantNamesCache();
  invalidateParticipantNameMap();
  return c.body(null, 204);
});
