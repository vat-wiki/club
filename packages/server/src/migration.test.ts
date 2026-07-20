import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterAll,describe, expect, it } from "vitest";

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

// Point the db.js module-level singleton at a throwaway temp BEFORE importing.
// Importing db.js runs runMigrations(db) on CLUB_DB as a top-level side effect;
// without this, the singleton lands on the cwd's club.db and can re-run a
// migration's ADD COLUMN against a db that already has the column (e.g. when
// this file's worker shares the cwd db with a prior run's leftovers). The
// migration scenarios below use their OWN `raw` Database via BASELINE_SCHEMA,
// fully independent of this singleton — it just needs to not blow up on import.
const singletonDb = join(tmpdir(), `club-migr-singleton-${randomUUID()}.db`);
files.push(singletonDb);
process.env.CLUB_DB = singletonDb;

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
    expect(version?.version).toBe(12);

    raw.close();
  });

  it("is idempotent — re-running the runner on an already-migrated db is a no-op", () => {
    const path = tmpDb();
    files.push(path);
    const raw = new Database(path);
    raw.exec(BASELINE_SCHEMA);
    runMigrations(raw); // applies the full chain (1..11) on a fresh db

    expect(() => runMigrations(raw)).not.toThrow(); // second start-up → no-op
    const version = raw
      .prepare<[], { version: number }>("SELECT version FROM schema_version")
      .get();
    expect(version?.version).toBe(12);
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
      `INSERT INTO participants (id, name, key_hash, created_at)
         VALUES ('p2', 'trinity', 'h', 1);`,
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

describe("MR1b — category-blind migration (v9): drops participant.kind", () => {
  // club no longer classifies participants (category-blind — see
  // .pd-docs/requirements/category-blind.md). v9 drops the kind column.
  it("removes the kind column and reaches schema_version 11", () => {
    const path = tmpDb();
    files.push(path);
    const raw = new Database(path);
    raw.exec(BASELINE_SCHEMA);
    runMigrations(raw); // full chain incl. v9 + v10 + v11

    const cols = raw
      .prepare<[], { name: string }>("PRAGMA table_info(participants)")
      .all()
      .map((c) => c.name);
    expect(cols).not.toContain("kind");

    const version = raw
      .prepare<[], { version: number }>("SELECT version FROM schema_version")
      .get();
    expect(version?.version).toBe(12);
    raw.close();
  });

  it("is idempotent — re-running on an already-dropped db is a no-op", () => {
    const path = tmpDb();
    files.push(path);
    const raw = new Database(path);
    raw.exec(BASELINE_SCHEMA);
    runMigrations(raw);
    expect(() => runMigrations(raw)).not.toThrow();
    const version = raw
      .prepare<[], { version: number }>("SELECT version FROM schema_version")
      .get();
    expect(version?.version).toBe(12);
    raw.close();
  });
});

describe("MR3 — performance indexes migration (v11)", () => {
  it("creates key_hash, name, and room-created indexes", () => {
    const path = tmpDb();
    files.push(path);
    const raw = new Database(path);
    raw.exec(BASELINE_SCHEMA);
    runMigrations(raw);

    for (const idxName of [
      "idx_participants_key_hash",
      "idx_participants_name",
      "idx_messages_room_created",
    ]) {
      const idx = raw
        .prepare<[], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
        )
        .get(idxName);
      expect(idx?.name).toBe(idxName);
    }

    const version = raw
      .prepare<[], { version: number }>("SELECT version FROM schema_version")
      .get();
    expect(version?.version).toBe(12);

    // Populate data so EXPLAIN QUERY PLAN is meaningful.
    raw.exec(
      `INSERT INTO participants (id, name, key_hash, created_at)
         VALUES ('p1','a','h',1);`,
    );
    raw.exec(
      `INSERT INTO messages (id, participant_id, content, created_at, room)
         VALUES ('m1','p1','hi',1,'general');`,
    );

    // Lookup by key_hash should use idx_participants_key_hash.
    const planK = raw
      .prepare<[string], { detail: string }>(
        `EXPLAIN QUERY PLAN SELECT id FROM participants WHERE key_hash = ?`,
      )
      .all("h")
      .map((r) => r.detail)
      .join(" ");
    expect(planK).toMatch(/USING.*INDEX|SEARCH/);
    expect(planK).not.toContain("SCAN participants");

    // Lookup by name should use idx_participants_name.
    const planN = raw
      .prepare<[string], { detail: string }>(
        `EXPLAIN QUERY PLAN SELECT id FROM participants WHERE name = ?`,
      )
      .all("a")
      .map((r) => r.detail)
      .join(" ");
    expect(planN).toMatch(/USING.*INDEX|SEARCH/);
    expect(planN).not.toContain("SCAN participants");

    raw.close();
  });

  it("is idempotent — re-running after v11 is a no-op", () => {
    const path = tmpDb();
    files.push(path);
    const raw = new Database(path);
    raw.exec(BASELINE_SCHEMA);
    runMigrations(raw);
    expect(() => runMigrations(raw)).not.toThrow();
    const version = raw
      .prepare<[], { version: number }>("SELECT version FROM schema_version")
      .get();
    expect(version?.version).toBe(12);
    raw.close();
  });
});


describe("MR2 — reactions index migration (v10)", () => {
  it("creates idx_reactions_message_id and keeps lookups bounded", () => {
    const path = tmpDb();
    files.push(path);
    const raw = new Database(path);
    raw.exec(BASELINE_SCHEMA);
    runMigrations(raw);

    // Verify the index exists on the reactions table.
    const idx = raw
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_reactions_message_id'",
      )
      .get();
    expect(idx).not.toBeUndefined();

    // Populate a few messages + reactions so the query plan is meaningful.
    raw.exec(`
      INSERT INTO participants (id, name, key_hash, created_at)
      VALUES ('p1','a','h',1),('p2','b','h',2);
    `);
    raw.exec(`
      INSERT INTO messages (id, participant_id, content, created_at, room)
      VALUES ('m1','p1','hi',1,'general'),
             ('m2','p1','by',2,'general');
    `);
    raw.exec(`
      INSERT INTO reactions (message_id, participant_id, emoji)
      VALUES ('m1','p1','👍'),('m1','p2','🎉'),
             ('m2','p1','👍');
    `);

    // The WHERE message_id query must use an index (never a full scan).
    // For the simple (emoji, participant_id) select SQLite picks the existing
    // UNIQUE covering autoindex; for wider selections (e.g. aggregate joins)
    // idx_reactions_message_id is what bounds the scan.
    const plan = raw
      .prepare<[string], { detail: string }>(
        `EXPLAIN QUERY PLAN SELECT emoji, participant_id FROM reactions WHERE message_id = ?`,
      )
      .all("m1");
    const details = plan.map((r) => r.detail).join(" ");
    expect(details).toMatch(/USING.*INDEX/); // bounded by *an* index
    expect(details).not.toContain("SCAN reactions");

    const version = raw
      .prepare<[], { version: number }>("SELECT version FROM schema_version")
      .get();
    expect(version?.version).toBe(12);
    raw.close();
  });

  it("is idempotent — re-running after v10 is a no-op", () => {
    const path = tmpDb();
    files.push(path);
    const raw = new Database(path);
    raw.exec(BASELINE_SCHEMA);
    runMigrations(raw);
    expect(() => runMigrations(raw)).not.toThrow();
    const version = raw
      .prepare<[], { version: number }>("SELECT version FROM schema_version")
      .get();
    expect(version?.version).toBe(12);
    raw.close();
  });
});
