import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";
import { afterAll,describe, expect, it } from "vitest";

// Point the SQLite DB at a unique temp file BEFORE any module that transitively
// imports db.ts is evaluated. db.ts reads CLUB_DB at import time.
const dbPath = join(tmpdir(), `club-test-${randomUUID()}.db`);
process.env.CLUB_DB = dbPath;

const { me } = await import("./me.js");
const { participants } = await import("./participants.js");

const app = new Hono();
app.route("/participants", participants);
app.route("/me", me);

afterAll(() => {
  for (const ext of ["", "-wal", "-shm"]) rmSync(dbPath + ext, { force: true });
});

async function mintKey(name: string): Promise<string> {
  const res = await app.request("/participants", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).key;
}

function auth(key: string) {
  return { headers: { Authorization: `Bearer ${key}` } };
}

describe("GET /me", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await app.request("/me");
    expect(res.status).toBe(401);
  });

  it("returns the authenticated participant (id + name)", async () => {
    const aliceKey = await mintKey("get-me-alice");
    const res = await app.request("/me", auth(aliceKey));
    expect(res.status).toBe(200);
    const me = await res.json();
    expect(me.name).toBe("get-me-alice");
    expect(me.id).toBeDefined();
    expect(typeof me.id).toBe("string");
    expect(me.id).not.toBe("");
  });

  it("returns the same identity for every call within a session", async () => {
    const bobKey = await mintKey("get-me-bob");
    const first = await (await app.request("/me", auth(bobKey))).json();
    const second = await (await app.request("/me", auth(bobKey))).json();
    expect(first.id).toBe(second.id);
    expect(first.name).toBe(second.name);
  });

  it("isolates identity between participants (no key leakage)", async () => {
    const aliceKey = await mintKey("get-me-isolate-a");
    const bobKey = await mintKey("get-me-isolate-b");
    const alice = await (await app.request("/me", auth(aliceKey))).json();
    const bob = await (await app.request("/me", auth(bobKey))).json();
    expect(alice.id).not.toBe(bob.id);
    expect(alice.name).toBe("get-me-isolate-a");
    expect(bob.name).toBe("get-me-isolate-b");
  });

  it("rejects an invalid bearer token", async () => {
    const res = await app.request("/me", {
      headers: { Authorization: "Bearer not-a-real-key" },
    });
    expect(res.status).toBe(401);
  });
});
