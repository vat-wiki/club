import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";
import { afterAll, describe, expect, it } from "vitest";

// Point the SQLite DB at a unique temp file BEFORE any module that
// transitively imports db.ts is evaluated. db.ts reads CLUB_DB at import time.
const dbPath = join(tmpdir(), `club-part-input-sec-${randomUUID()}.db`);
process.env.CLUB_DB = dbPath;

const { participants } = await import("./participants.js");
const app = new Hono();
app.route("/participants", participants);

// Mount the messages route onto the same app instance so the auth-boundary
// tests can exercise requireAuth on a route that actually requires auth.
const { messages } = await import("./messages.js");
app.route("/messages", messages);

afterAll(() => {
  for (const ext of ["", "-wal", "-shm"]) rmSync(dbPath + ext, { force: true });
});

function auth(key: string) {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

/** Create a new participant and return the API key. Helper used in both suites. */
async function mintKey(name: string): Promise<string> {
  const res = await app.request("/participants", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(201);
  const data = await res.json();
  return data.key as string;
}

/** Participant name that always satisfies the shared schema
 *  ^[a-z0-9][a-z0-9-]{0,29}$ (lowercase letters, digits, hyphens only). */
function freshName(prefix: string = "sec"): string {
  return `${prefix}-${Buffer.alloc(6).toString("hex")}`;
}

// ── Name boundary / input hardening ───────────────────────────────
// Name validation is the shared Zod schema (CreateParticipantRequest)
// at the route level. These tests confirm the API boundary rejects
// inputs that would be problematic downstream: pure-whitespace,
// whitespace-padded handles, and control characters (including CRLF
// sequences that would break SSE framing or log parsing).
//
// These are "input security" tests — they verify the endpoint rejects
// dangerous payloads at the API boundary rather than silently storing
// them in the database. This matches the existing content-security
// (sanitizeContent) and emoji-security (control-char strip) tests for
// the other user-supplied fields.

const dangerousNames = [
  { name: "   ", label: "pure spaces" },
  { name: "  bob  ", label: "whitespace-padded" },
  { name: "bob\r\n", label: "CRLF appended" },
  { name: "bob\x00alice", label: "NUL embedded" },
  { name: "bob\neve", label: "newline embedded" },
  { name: "bob\teve", label: "tab embedded" },
  { name: "\r", label: "CR only" },
  { name: "\n", label: "LF only" },
  { name: "\t", label: "TAB only" },
  { name: "\x7f", label: "DEL only" },
];

describe("POST /participants — input security", () => {
  for (const { name, label } of dangerousNames) {
    it(`rejects name containing ${label}`, async () => {
      const resp = await app.request("/participants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      expect(resp.status).toBe(400);
    });
  }

  it("rejects a name that is a duplicate of an existing participant", async () => {
    const taken = freshName("taken");
    await mintKey(taken);
    const resp = await app.request("/participants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: taken }),
    });
    expect(resp.status).toBe(409);
  });

  it("accepts a valid short name", async () => {
    const resp = await app.request("/participants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: freshName() }),
    });
    expect(resp.status).toBe(201);
  });
});

// ── Auth middleware boundary ──────────────────────────────────────
// requireAuth is wired as app.use("*", requireAuth) in every route
// module (messages, rooms, members, files, agents). The POST /participants
// endpoint is the only route that doesn't require auth — so we test
// the auth boundary on the messages route here. This verifies:
//   • missing Authorization header → 401
//   • malformed Authorization header → 401
//   • valid key → request is accepted
//   • garbage key → 401 (key_hash mismatch)
//
// Each test mints its own participant so the shared Hono app + db.ts
// singleton persisting within a test file can't cause name collisions.

describe("POST /messages — auth middleware boundary", () => {
  it("rejects a request with no Authorization header", async () => {
    const resp = await app.request("/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });
    expect(resp.status).toBe(401);
  });

  it("rejects a malformed Authorization header", async () => {
    const resp = await app.request("/messages", {
      method: "POST",
      headers: {
        authorization: "Basic abc123",
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: "hello" }),
    });
    expect(resp.status).toBe(401);
  });

  it("rejects a valid-format header with an invalid key", async () => {
    const resp = await app.request("/messages", {
      method: "POST",
      headers: {
        authorization: `Bearer club_${Buffer.alloc(24).toString("base64url")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: "hello" }),
    });
    expect(resp.status).toBe(401);
  });

  it("accepts a request with a valid key", async () => {
    const key = await mintKey(freshName("auth"));
    const resp = await app.request("/messages", {
      method: "POST",
      headers: auth(key),
      body: JSON.stringify({ content: "hello" }),
    });
    expect(resp.status).toBe(201);
  });
});
