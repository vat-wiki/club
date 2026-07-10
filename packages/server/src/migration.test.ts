import { describe, it, expect, afterAll } from "vitest";
import Database from "better-sqlite3";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

// MR1 — data model + migration. We stand up a pre-room ("v6") db on an
// isolated connection (independent of the CLUB_DB singleton the route tests
// use), then drive the v6→v7 upgrade via the exported runner and assert:
// existing messages backfill to room='general', the rooms table + general row
// appear, schema_version reaches 7, and re-running the runner is a no-op.

// A temp file PER scenario so each can build its own v6 db fresh.
function tmpDb(): string {
  return join(tmpdir(), `club-migr-${randomUUID()}.db`);
}

const files: string[] = [];
afterAll(() => {
  for (const f of files)
    for (const ext of ["", "-wal", "-shm"]) rmSync(f + ext, { force: true });
});

// Imported lazily AFTER we control the env; runMigrations/BASELINE_SCHEMA are
// pure helpers that operate on whatever Database you hand them.
const { runMigrations, BASELINE_SCHEMA } = await import("./db.js");

describe("MR1 — multi-room migration (v6 → v7)", () => {
  it("backfills existing messages to room='general' and seeds the general room", () => {
    const path = tmpDb();
    files.push(path);
    const raw = new Database(path);
    raw.exec(BASELINE_SCHEMA);
    // Apply everything UP TO v6 (so room migration 7 has NOT run yet).
    runMigrations(raw, 6);
    // Simulate a pre-room world: a participant + a message with NO room column.
    raw.exec(
      `INSERT INTO participants (id, name, kind, key_hash, created_at)
         VALUES ('p1', 'neo', 'human', 'h', 1000);`,
    );
    raw.exec(
      `INSERT INTO messages (id, participant_id, content, created_at)
         VALUES ('m1', 'p1', 'hello old world', 2000);`,
    );
    // Sanity: at v6 there is no room column yet.
    const colsBefore = raw
      .prepare<[], { name: string }>("PRAGMA table_info(messages)")
      .all()
      .map((c) => c.name);
    expect(colsBefore).not.toContain("room");

    // Now run the full chain — applies v7.
    runMigrations(raw);

    const msg = raw
      .prepare<[], { room: string }>("SELECT room FROM messages WHERE id = 'm1'")
      .get();
    expect(msg?.room).toBe("general"); // backfilled in place, zero data loss

    const general = raw
      .prepare<[], { slug: string; id: string }>(
        "SELECT id, slug FROM rooms WHERE slug = 'general'",
      )
      .get();
    expect(general).toEqual({ id: "general", slug: "general" });

    const version = raw
      .prepare<[], { version: number }>("SELECT version FROM schema_version")
      .get();
    expect(version?.version).toBe(7);

    raw.close();
  });

  it("is idempotent — re-running the runner on an already-migrated db is a no-op", () => {
    const path = tmpDb();
    files.push(path);
    const raw = new Database(path);
    raw.exec(BASELINE_SCHEMA);
    runMigrations(raw); // applies the full chain (1..7) on a fresh db

    expect(() => runMigrations(raw)).not.toThrow(); // second start-up → no-op
    const version = raw
      .prepare<[], { version: number }>("SELECT version FROM schema_version")
      .get();
    expect(version?.version).toBe(7);
    // general still exactly one row (INSERT OR IGNORE is idempotent too).
    const count = raw
      .prepare<[], { n: number }>(
        "SELECT COUNT(*) AS n FROM rooms WHERE slug = 'general'",
      )
      .get();
    expect(count?.n).toBe(1);
    raw.close();
  });

  it("a freshly created message defaults to room='general' when none given", () => {
    const path = tmpDb();
    files.push(path);
    const raw = new Database(path);
    raw.exec(BASELINE_SCHEMA);
    runMigrations(raw);
    raw.exec(
      `INSERT INTO participants (id, name, kind, key_hash, created_at)
         VALUES ('p2', 'trinity', 'human', 'h', 1);`,
    );
    // Insert WITHOUT specifying room — the column default must kick in.
    raw.exec(
      `INSERT INTO messages (id, participant_id, content, created_at)
         VALUES ('m2', 'p2', 'default me', 5);`,
    );
    const msg = raw
      .prepare<[], { room: string }>("SELECT room FROM messages WHERE id = 'm2'")
      .get();
    expect(msg?.room).toBe("general");
    raw.close();
  });
});
