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
const { getParticipantByKeyHash, db, insertMessage, getAllParticipants } = await import("../db.js");
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
      bio: "",
      createdAt: expect.any(Number),
    });
  });

  it("accepts an optional bio and echoes it back (and through /me)", async () => {
    const res = await app.request("/participants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "withbio", bio: "运维 agent，常驻 :6600" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.participant.bio).toBe("运维 agent，常驻 :6600");

    // The bio survives a fresh /me lookup with the issued key.
    const me = await app.request("/me", {
      headers: { Authorization: `Bearer ${body.key}` },
    });
    expect(me.status).toBe(200);
    expect((await me.json()).bio).toBe("运维 agent，常驻 :6600");
  });

  it("strips control chars (single-line) from the bio on create", async () => {
    const res = await app.request("/participants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "cleanbio", bio: "line1\nline2\tend" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.participant.bio).toBe("line1line2end");
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

// ── Open model: kick (account delete) + edit anyone's bio ───────────
describe("open model — kick + edit-anyone-bio", () => {
  async function mint(name: string): Promise<{ key: string; id: string }> {
    const res = await app.request("/participants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = (await res.json()) as any;
    return { key: body.key, id: body.participant.id };
  }

  it("PATCH /participants/:id sets another participant's bio (open model)", async () => {
    const caller = await mint("bio-editor");
    const target = await mint("bio-target");
    const res = await app.request(`/participants/${target.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${caller.key}`,
      },
      body: JSON.stringify({ bio: "rewritten by someone else" }),
    });
    expect(res.status).toBe(204);
    // The target reads back the new bio through their own /me.
    const me = await app.request("/me", {
      headers: { Authorization: `Bearer ${target.key}` },
    });
    expect((await me.json()).bio).toBe("rewritten by someone else");
  });

  it("POST /participants/:id/kick soft-deletes the account (revokes key, hides from roster, preserves messages)", async () => {
    const caller = await mint("kicker");
    const target = await mint("kick-target");
    // Target authors a message, then is kicked by the caller.
    insertMessage("m1", target.id, "I will be erased", 0, null, null, "general");
    try {
      const res = await app.request(`/participants/${target.id}/kick`, {
        method: "POST",
        headers: { Authorization: `Bearer ${caller.key}` },
      });
      expect(res.status).toBe(204);
      // The kicked participant can no longer authenticate.
      const me = await app.request("/me", {
        headers: { Authorization: `Bearer ${target.key}` },
      });
      expect(me.status).toBe(401);
      // The account is flagged deleted and dropped from the roster...
      const pRow = db
        .prepare("SELECT deleted FROM participants WHERE id = ?")
        .get(target.id) as { deleted: number } | undefined;
      expect(pRow?.deleted).toBe(1);
      expect(getAllParticipants().find((p) => p.id === target.id)).toBeUndefined();
      // ...but the authored message is preserved untouched (content + not deleted).
      const msg = db
        .prepare("SELECT content, deleted FROM messages WHERE id = 'm1'")
        .get() as { content: string; deleted: number } | undefined;
      expect(msg?.content).toBe("I will be erased");
      expect(msg?.deleted).toBe(0);
    } finally {
      // This suite's beforeEach wipes only participants (messages are
      // FK-referenced), so remove the row we inserted or the next test's
      // participant wipe trips a FOREIGN KEY constraint.
      db.prepare("DELETE FROM messages WHERE id = 'm1'").run();
    }
  });

  it("kick requires authentication (no bearer → 401)", async () => {
    const target = await mint("kick-noauth-target");
    const res = await app.request(`/participants/${target.id}/kick`, {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });
});

// ── rotate-key + self-delete (two-factor account management) ───────
describe("rotate-key + self-delete", () => {
  async function mint(name: string): Promise<{
    key: string;
    id: string;
    recoverCode: string;
  }> {
    const res = await app.request("/participants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = (await res.json()) as any;
    return { key: body.key, id: body.participant.id, recoverCode: body.recoverCode };
  }

  it("POST /participants/:id/rotate-key reissues key + recovery code; old key fails, new key works", async () => {
    const a = await mint("rotator");
    const res = await app.request(`/participants/${a.id}/rotate-key`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${a.key}`,
      },
      body: JSON.stringify({ password: a.key }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.key).toMatch(/^club_/);
    expect(body.recoverCode).toMatch(/^club_recover_/);
    expect(body.key).not.toBe(a.key);
    expect(body.recoverCode).not.toBe(a.recoverCode);

    // The old key can no longer authenticate.
    const oldMe = await app.request("/me", {
      headers: { Authorization: `Bearer ${a.key}` },
    });
    expect(oldMe.status).toBe(401);
    // The new key authenticates as the same participant.
    const newMe = await app.request("/me", {
      headers: { Authorization: `Bearer ${body.key}` },
    });
    expect(newMe.status).toBe(200);
    expect((await newMe.json()).id).toBe(a.id);
  });

  it("rotate-key rejects a wrong password with 403 (no key reissue)", async () => {
    const a = await mint("rotator-wrong");
    const res = await app.request(`/participants/${a.id}/rotate-key`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${a.key}`,
      },
      body: JSON.stringify({ password: "club_wrong_key" }),
    });
    expect(res.status).toBe(403);
    // Original key still works - nothing was rotated.
    const me = await app.request("/me", {
      headers: { Authorization: `Bearer ${a.key}` },
    });
    expect(me.status).toBe(200);
  });

  it("rotate-key rejects a mismatched :id with 404 (cannot rotate someone else)", async () => {
    const a = await mint("rotator-self");
    const other = await mint("rotator-other");
    const res = await app.request(`/participants/${other.id}/rotate-key`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${a.key}`,
      },
      body: JSON.stringify({ password: a.key }),
    });
    expect(res.status).toBe(404);
  });

  it("rotate-key requires authentication (no bearer → 401, not 500)", async () => {
    const a = await mint("rotator-noauth");
    const res = await app.request(`/participants/${a.id}/rotate-key`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: a.key }),
    });
    expect(res.status).toBe(401);
  });

  it("DELETE /participants/:id self-deletes with both factors; key becomes invalid", async () => {
    const a = await mint("self-deleter");
    const res = await app.request(`/participants/${a.id}`, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${a.key}`,
      },
      body: JSON.stringify({ password: a.key, recoverCode: a.recoverCode }),
    });
    expect(res.status).toBe(204);
    // Can no longer authenticate.
    const me = await app.request("/me", {
      headers: { Authorization: `Bearer ${a.key}` },
    });
    expect(me.status).toBe(401);
    // Dropped from the roster.
    expect(getAllParticipants().find((p) => p.id === a.id)).toBeUndefined();
  });

  it("DELETE rejects a wrong recoverCode with 403 (account survives)", async () => {
    const a = await mint("self-deleter-bad-code");
    const res = await app.request(`/participants/${a.id}`, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${a.key}`,
      },
      body: JSON.stringify({ password: a.key, recoverCode: "club_recover_wrong" }),
    });
    expect(res.status).toBe(403);
    // Account still authenticates.
    const me = await app.request("/me", {
      headers: { Authorization: `Bearer ${a.key}` },
    });
    expect(me.status).toBe(200);
  });

  it("DELETE rejects a wrong password with 403 (account survives)", async () => {
    const a = await mint("self-deleter-bad-pass");
    const res = await app.request(`/participants/${a.id}`, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${a.key}`,
      },
      body: JSON.stringify({ password: "club_wrong_key", recoverCode: a.recoverCode }),
    });
    expect(res.status).toBe(403);
    const me = await app.request("/me", {
      headers: { Authorization: `Bearer ${a.key}` },
    });
    expect(me.status).toBe(200);
  });

  it("DELETE requires authentication (no bearer → 401, not 500)", async () => {
    const a = await mint("self-deleter-noauth");
    const res = await app.request(`/participants/${a.id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: a.key, recoverCode: a.recoverCode }),
    });
    expect(res.status).toBe(401);
  });
});
