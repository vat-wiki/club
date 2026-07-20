import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach,describe, expect, it } from "vitest";

// Point the SQLite DB at a unique temp file BEFORE any module that transitively
// imports db.ts is evaluated. db.ts reads CLUB_DB at import time.
const dbPath = join(tmpdir(), `club-test-${randomUUID()}.db`);
process.env.CLUB_DB = dbPath;

// Dynamic import keeps the env-first ordering intact for hermetic isolation.
const { participants } = await import("./participants.js");
const { getParticipantByKeyHash, db } = await import("../db.js");
const { hashKey } = await import("../crypto.js");
const { requireAuth } = await import("../auth.js");
const { Hono } = await import("hono");

// Mount auth-protected /me so we can verify a freshly-issued key really
// authenticates through requireAuth and that duplicate-name issuance never
// happened.
const app = new Hono();
app.route("/participants", participants);
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

// ── POST /participants ──────────────────────────────────────────────

describe("POST /participants", () => {
  it("returns 201 with key + recoverCode + participant for a fresh name", async () => {
    const res = await app.request("/participants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "alice" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.key).toMatch(/^club_/);
    expect(typeof body.recoverCode).toBe("string");
    expect(body.recoverCode).toMatch(/^club_recover_/);
    expect(body.participant).toEqual({
      id: expect.any(String),
      name: "alice",
      createdAt: expect.any(Number),
    });
  });

  it("issues a key that actually authenticates through requireAuth (/me)", async () => {
    const create = await app.request("/participants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "bob" }),
    });
    const issued = (await create.json()) as any;
    const me = await app.request("/me", {
      headers: { Authorization: `Bearer ${issued.key}` },
    });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as any;
    expect(meBody.name).toBe("bob");
    expect(meBody.id).toBe(issued.participant.id);
  });

  it("stores the key as sha256 in participants.key_hash (never plaintext)", async () => {
    const create = await app.request("/participants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "carol" }),
    });
    const issued = (await create.json()) as any;

    // Read the persisted key_hash directly from the DB to confirm it is the
    // sha256 digest of the issued plaintext key (and not the plaintext itself).
    const row = db.prepare(
      `SELECT key_hash FROM participants WHERE name = ?`,
    ).get("carol") as { key_hash: string };
    expect(row).toBeDefined();
    expect(row.key_hash).toBe(hashKey(issued.key));
    expect(row.key_hash).not.toBe(issued.key);

    // Also verify the DB-lookup path used by the auth middleware can find the
    // same participant (end-to-end: issuance -> persist -> auth lookup).
    const authLookup = getParticipantByKeyHash(hashKey(issued.key));
    expect(authLookup).toBeDefined();
    expect(authLookup!.name).toBe("carol");
  });

  it("rejects duplicate names with 409", async () => {
    const first = await app.request("/participants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "duplicate" }),
    });
    expect(first.status).toBe(201);

    const second = await app.request("/participants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "duplicate" }),
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'name "duplicate" is taken' });

    // Verify only one participant with that name exists in the DB.
    const rows = db
      .prepare(`SELECT COUNT(*) AS n FROM participants WHERE name = ?`)
      .get("duplicate") as { n: number };
    expect(rows.n).toBe(1);
  });

  it("rejects a missing name field with 400 (via parseJsonBody + schema)", async () => {
    const res = await app.request("/participants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("rejects invalid JSON with 400", async () => {
    const res = await app.request("/participants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid JSON" });
  });

  it("rejects non-JSON content-type (requireJson guard)", async () => {
    const res = await app.request("/participants", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{ \"name\": \"x\" }",
    });
    expect(res.status).toBe(415);
  });

  it("rejects a name that violates the shared ParticipantName schema (whitespace-terminated name)", async () => {
    const res = await app.request("/participants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "bad name " }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a name containing control characters via the shared ParticipantName schema", async () => {
    const res = await app.request("/participants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "evil\nname" }),
    });
    expect(res.status).toBe(400);
  });
});
