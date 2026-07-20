import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll,beforeEach, describe, expect, it } from "vitest";

/**
 * Performance / correctness tests for insertMentions() batched inbox
 * insertion. Verifies: (1) multiple @mentions in one message are written
 * in a single transactional round-trip, (2) duplicates within the batch
 * are ignored via UNIQUE(message_id, participant_id), (3) empty input is
 * a no-op, (4) unread mentions are still returned correctly by
 * getUnreadMentions.
 */

// Isolate the SQLite database so the global db module runs migrations against
// our temp path. Must be set before any import that touches db.ts.
const dbPath = join(tmpdir(), `club-mention-batch-${randomUUID()}.db`);
process.env.CLUB_DB = dbPath;

import type { MentionInsert } from "./db.js";

const {
  db,
  runMigrations,
  insertMentions,
  getUnreadMentions,
  markMentionRead,
} = await import("./db.js");

afterAll(() => {
  for (const ext of ["", "-wal", "-shm"]) rmSync(dbPath + ext, { force: true });
});

// Ensure a clean schema for each test file.
runMigrations(db, Infinity);

const alice = { id: "alice", name: "alice", key_hash: "k_alice", created_at: 1 };
const bob = { id: "bob", name: "bob", key_hash: "k_bob", created_at: 2 };
const carol = { id: "carol", name: "carol", key_hash: "k_carol", created_at: 3 };

function seedParticipants(rows: typeof alice[]) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO participants (id, name, key_hash, created_at)
    VALUES (?, ?, ?, ?)
  `);
  for (const r of rows) stmt.run(r.id, r.name, r.key_hash, r.created_at);
}

function seedMessage(id: string, authorId: string, room = "general") {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO messages (id, participant_id, content, created_at, room)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(id, authorId, "hello @mentions", Date.now(), room);
}

describe("insertMentions", () => {
  beforeEach(() => {
    // Truncate tables used by the tests between cases.
    db.exec(`DELETE FROM mentions; DELETE FROM messages; DELETE FROM participants;`);
  });

  it("returns 0 for empty input", () => {
    expect(insertMentions([])).toBe(0);
  });

  it("inserts multiple mentions in a single batch", () => {
    seedParticipants([alice, bob, carol]);
    seedMessage("msg1", alice.id);
    const now = Date.now();
    const rows: MentionInsert[] = [
      { id: "m1", messageId: "msg1", participantId: bob.id, authorId: alice.id, room: "general", createdAt: now },
      { id: "m2", messageId: "msg1", participantId: carol.id, authorId: alice.id, room: "general", createdAt: now },
    ];
    expect(insertMentions(rows)).toBe(2);
  });

  it("ignores duplicates within the same batch", () => {
    seedParticipants([alice, bob]);
    seedMessage("msg2", alice.id);
    const now = Date.now();
    const rows: MentionInsert[] = [
      { id: "m1", messageId: "msg2", participantId: bob.id, authorId: alice.id, room: "general", createdAt: now },
      { id: "m2", messageId: "msg2", participantId: bob.id, authorId: alice.id, room: "general", createdAt: now },
    ];
    expect(insertMentions(rows)).toBe(1);
  });

  it("unread mentions include the batched rows", () => {
    seedParticipants([alice, bob, carol]);
    seedMessage("msg3", alice.id);
    const now = Date.now();
    insertMentions([
      { id: "m1", messageId: "msg3", participantId: bob.id, authorId: alice.id, room: "general", createdAt: now },
      { id: "m2", messageId: "msg3", participantId: carol.id, authorId: alice.id, room: "general", createdAt: now },
    ]);
    const unreadBob = getUnreadMentions(bob.id, 10);
    expect(unreadBob).toHaveLength(1);
    expect(unreadBob[0].author_id).toBe(alice.id);
    expect(unreadBob[0].room).toBe("general");
  });

  it("read marking works after batched insert", () => {
    seedParticipants([alice, bob]);
    seedMessage("msg4", alice.id);
    const now = Date.now();
    insertMentions([
      { id: "m1", messageId: "msg4", participantId: bob.id, authorId: alice.id, room: "general", createdAt: now },
    ]);
    markMentionRead("m1", now + 1);
    expect(getUnreadMentions(bob.id, 10)).toHaveLength(0);
  });
});
