import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";
import { afterAll,describe, expect, it } from "vitest";

// Point the SQLite DB at a unique temp file BEFORE any module that transitively
// imports db.ts is evaluated. db.ts reads CLUB_DB at import time, so a static
// import would race ahead of this assignment — hence the dynamic imports below.
const dbPath = join(tmpdir(), `club-test-${randomUUID()}.db`);
process.env.CLUB_DB = dbPath;

const { members } = await import("./members.js");
const { participants } = await import("./participants.js");

// Mount only the routes this test drives. members is auth-gated, so we also
// mount participants (no auth) to mint a usable bearer key.
const app = new Hono();
app.route("/participants", participants);
app.route("/members", members);

afterAll(() => {
  for (const ext of ["", "-wal", "-shm"]) rmSync(dbPath + ext, { force: true });
});

async function mintKey(name: string): Promise<string> {
  const res = await app.request("/participants", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const body = await res.json();
  return body.key;
}

describe("GET /members", () => {
  it("returns participants in the shared Participant shape (camelCase, never snake_case)", async () => {
    const key = await mintKey("alice");

    const res = await app.request("/members", {
      headers: { Authorization: `Bearer ${key}` },
    });

    expect(res.status).toBe(200);
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list).toHaveLength(1);
    // Exact-shape assertion: only the three contract keys, camelCase, no leak.
    expect(list[0]).toEqual({
      id: expect.any(String),
      name: "alice",
      createdAt: expect.any(Number),
    });
    expect(list[0]).not.toHaveProperty("created_at");
  });

  it("lists every participant ordered by createdAt ascending", async () => {
    // Tests in a file share the DB, so "alice" from the test above is present
    // here too. Mint two more distinct participants to exercise multi-row shape
    // and ordering.
    const key = await mintKey("carol");
    await mintKey("bot-1");

    const res = await app.request("/members", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const list = await res.json();

    // at least the three minted in this file (alice, carol, bot-1)
    expect(list.length).toBeGreaterThanOrEqual(3);
    // every row honors the contract — no snake_case leak on any of them
    for (const p of list) {
      expect(p).not.toHaveProperty("created_at");
      expect(p.createdAt).toEqual(expect.any(Number));
    }
    // ordering by createdAt ascending
    const times = list.map((p: { createdAt: number }) => p.createdAt);
    const sorted = [...times].sort((a, b) => a - b);
    expect(times).toEqual(sorted);
  });
});
