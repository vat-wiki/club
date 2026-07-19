import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createHash } from "node:crypto";

// Point the SQLite DB at a unique temp file BEFORE any module that transitively
// imports db.ts is evaluated. db.ts reads CLUB_DB at import time.
//
// ⚠️ Hermeticity note: every server module (auth.js, crypto.js, db.js, …) MUST
// be loaded via dynamic `await import()` AFTER setting process.env.CLUB_DB. A
// static `import { requireAuth } from "../auth.js"` is hoisted by the ESM
// loader and runs BEFORE this module body, so db.ts evaluates with CLUB_DB
// undefined, falls back to cwd/club.db (the dev DB), and the test silently
// runs against the dev DB. If the dev DB has FK-referenced rows and FKs are on
// (better-sqlite3 is compiled with DEFAULT_FOREIGN_KEYS, so FKs default ON),
// `DELETE FROM participants` throws FOREIGN KEY constraint failed → 8/8 red.
// Dynamic imports keep the env-first ordering intact for hermetic isolation.
const dbPath = join(tmpdir(), `club-test-${randomUUID()}.db`);
process.env.CLUB_DB = dbPath;

const { participants } = await import("./participants.js");
const { getParticipantForRecover, getParticipantByKeyHash, db } = await import(
  "../db.js"
);
const { hashKey } = await import("../crypto.js");
const { requireAuth } = await import("../auth.js");
const { Hono } = await import("hono");

const app = new Hono();
app.route("/participants", participants);
// Mount /me to verify key rotation (old key -> 401) and compatibility (old
// participant, null recover_hash, /me still works).
app.get("/me", requireAuth, (c) => c.json(c.get("participant")));

afterAll(() => {
  for (const ext of ["", "-wal", "-shm"]) rmSync(dbPath + ext, { force: true });
});

// Each test starts on a clean participants table so assertions about row
// counts and existence are deterministic. messages/mentions are left alone
// (FK-referenced); we only wipe participants for isolation.
beforeEach(() => {
  db.prepare(`DELETE FROM participants`).run();
});

async function mint(name: string) {
  const res = await app.request("/participants", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return { res, body: (await res.json()) as any };
}

describe("POST /participants (recovery code)", () => {
  // AC3: response has key + recoverCode + participant; recover_hash lands in DB.
  it("returns { key, recoverCode, participant } and stores recover_hash = sha256(recoverCode)", async () => {
    const { res, body } = await mint("alice");
    expect(res.status).toBe(201);

    expect(typeof body.key).toBe("string");
    expect(body.key).toMatch(/^club_/);
    expect(typeof body.recoverCode).toBe("string");
    expect(body.recoverCode).toMatch(/^club_recover_/);
    expect(body.key).not.toBe(body.recoverCode);
    expect(body.participant).toEqual({
      id: expect.any(String),
      name: "alice",
      createdAt: expect.any(Number),
    });

    // recover_hash in DB must equal sha256(recoverCode) and must NOT equal the
    // plaintext or the key's hash.
    const row = getParticipantForRecover("alice")!;
    expect(row.recover_hash).toBe(
      createHash("sha256").update(body.recoverCode).digest("hex"),
    );
    expect(row.recover_hash).not.toBe(body.recoverCode);
    expect(row.recover_hash).not.toBe(hashKey(body.key));
  });

  it("returns distinct recovery codes across participants (high entropy)", async () => {
    const a = (await mint("a1")).body.recoverCode;
    const b = (await mint("a2")).body.recoverCode;
    expect(a).not.toBe(b);
  });
});

describe("POST /participants/recover", () => {
  it("succeeds, reissues key + fresh recovery code, reuses id/name (AC4/AC5/AC6 setup)", async () => {
    const created = (await mint("bob")).body;
    const originalId = created.participant.id;
    const originalKey = created.key;
    const originalCode = created.recoverCode;

    const res = await app.request("/participants/recover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "bob", recoverCode: originalCode }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.participant.id).toBe(originalId);
    expect(body.participant.name).toBe("bob");
    expect(body.key).toMatch(/^club_/);
    expect(body.key).not.toBe(originalKey);
    expect(body.recoverCode).toMatch(/^club_recover_/);
    expect(body.recoverCode).not.toBe(originalCode);

    // recover_hash rotated to the NEW code's hash (single-use + 换发).
    const row = getParticipantForRecover("bob")!;
    expect(row.recover_hash).toBe(
      createHash("sha256").update(body.recoverCode).digest("hex"),
    );
    expect(row.recover_hash).not.toBe(
      createHash("sha256").update(originalCode).digest("hex"),
    );
  });

  // AC5: old key is invalidated after recovery (key_hash rotated).
  it("invalidates the old key after recovery (old key -> /me 401)", async () => {
    const created = (await mint("carol")).body;

    // sanity: old key works before recovery
    const before = await app.request("/me", {
      headers: { Authorization: `Bearer ${created.key}` },
    });
    expect(before.status).toBe(200);

    await app.request("/participants/recover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "carol", recoverCode: created.recoverCode }),
    });

    const after = await app.request("/me", {
      headers: { Authorization: `Bearer ${created.key}` },
    });
    expect(after.status).toBe(401);

    // and the new key works
    const row = getParticipantByKeyHash(hashKey(created.key));
    expect(row).toBeUndefined();
  });

  // AC6: recovery code is single-use — second attempt with the (now rotated)
  // old code fails with 401.
  it("rejects reuse of the original recovery code (single-use)", async () => {
    const created = (await mint("dave")).body;

    const first = await app.request("/participants/recover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "dave", recoverCode: created.recoverCode }),
    });
    expect(first.status).toBe(200);

    const second = await app.request("/participants/recover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "dave", recoverCode: created.recoverCode }),
    });
    expect(second.status).toBe(401);
  });

  // AC7: uniform 401 — unknown name vs wrong code are indistinguishable.
  it("returns the same 401 body for unknown name and wrong code (no enumeration)", async () => {
    // create erin but don't use the returned body — we only need erin to exist
    await mint("erin");

    const unknownName = await app.request("/participants/recover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "does-not-exist", recoverCode: "club_recover_x" }),
    });
    const wrongCode = await app.request("/participants/recover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "erin", recoverCode: "club_recover_wrong" }),
    });

    expect(unknownName.status).toBe(401);
    expect(wrongCode.status).toBe(401);
    expect(await unknownName.json()).toEqual({ error: "invalid recovery code" });
    expect(await wrongCode.json()).toEqual({ error: "invalid recovery code" });
  });

  it("rejects empty/missing fields with 400 (not 401, to keep shape errors out of the auth path)", async () => {
    const res = await app.request("/participants/recover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "", recoverCode: "" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("compat: recover_hash = NULL (pre-existing participants)", () => {
  // AC10: a participant created before this feature (recover_hash NULL) still
  // works day-to-day: its key remains valid for /me, and the recover endpoint
  // refuses to recover it (uniform 401, treated like "no code armed").
  it("key still works for /me; recover returns uniform 401", async () => {
    // Insert a legacy row directly with NULL recover_hash, mimicking a
    // participant created before migration v2 backfilled the column.
    const legacyKey = "club_human_legacy_legacylegacylegacylegacy";
    const now = Date.now();
    db.prepare(
      `INSERT INTO participants (id, name, key_hash, recover_hash, created_at)
       VALUES (?, ?, ?, NULL, ?)`,
    ).run("01LEGACY", "legacy", hashKey(legacyKey), now);

    // /me still works with the legacy key
    const me = await app.request("/me", {
      headers: { Authorization: `Bearer ${legacyKey}` },
    });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as any;
    expect(meBody.name).toBe("legacy");

    // recover refuses (no code armed) — uniform 401, same body as elsewhere
    const rec = await app.request("/participants/recover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "legacy", recoverCode: "club_recover_anything" }),
    });
    expect(rec.status).toBe(401);
    expect(await rec.json()).toEqual({ error: "invalid recovery code" });
  });
});
