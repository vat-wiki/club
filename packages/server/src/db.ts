import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const dbPath = process.env.CLUB_DB ?? resolve(process.cwd(), "club.db");

// Ensure the parent dir exists (hidden ENV var to relocate the sqlite file).
if (!existsSync(dirname(dbPath))) mkdirSync(dirname(dbPath), { recursive: true });

export const db: Database.Database = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS participants (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL,            -- 'human' | 'agent'
  key_hash    TEXT NOT NULL,             -- sha256(plaintext key); plaintext never stored
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id             TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id),
  content        TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
`);

// Order messages by insertion time. We keep a rowid so 'since' cursor can use
// a monotonic sequence rather than the (sortable but ulid) id comparison,
// which would be fragile if clocks skew. Rowid is simplest & always-increasing.
export interface MessageRow {
  id: string;
  content: string;
  created_at: number;
  rowid: number;
  participant_id: string;
  author_name: string;
  author_kind: "human" | "agent";
}

export function insertMessage(
  id: string,
  participantId: string,
  content: string,
  createdAt: number,
): void {
  db.prepare(
    `INSERT INTO messages (id, participant_id, content, created_at) VALUES (?, ?, ?, ?)`,
  ).run(id, participantId, content, createdAt);
}

export function getAllParticipants() {
  return db
    .prepare<[], { id: string; name: string; kind: "human" | "agent"; created_at: number }>(
      `SELECT id, name, kind, created_at FROM participants ORDER BY created_at ASC`,
    )
    .all();
}

const afterStmt = db.prepare<[number, number], MessageRow>(
  `SELECT m.id, m.content, m.created_at, m.rowid,
          p.id AS participant_id, p.name AS author_name, p.kind AS author_kind
   FROM messages m JOIN participants p ON p.id = m.participant_id
   WHERE m.rowid > ? ORDER BY m.rowid ASC LIMIT ?`,
);

const recentStmt = db.prepare<[number], MessageRow>(
  `SELECT m.id, m.content, m.created_at, m.rowid,
          p.id AS participant_id, p.name AS author_name, p.kind AS author_kind
   FROM messages m JOIN participants p ON p.id = m.participant_id
   ORDER BY m.rowid DESC LIMIT ?`,
);

const sinceStmt = db.prepare<[string], { rowid: number }>(
  `SELECT rowid FROM messages WHERE id = ?`,
);

export function getMessagesAfter(rowid: number, limit: number): MessageRow[] {
  return afterStmt.all(rowid, limit);
}

export function getRecentMessages(limit: number): MessageRow[] {
  return recentStmt.all(limit).reverse();
}

export function getMessagesSince(sinceId: string, limit: number) {
  const row = sinceStmt.get(sinceId);
  if (!row) return { rowid: 0, messages: [] as MessageRow[] };
  return { rowid: row.rowid, messages: getMessagesAfter(row.rowid, limit) };
}

export function getParticipantByKeyHash(hash: string) {
  return db
    .prepare<
      [string],
      { id: string; name: string; kind: "human" | "agent"; created_at: number }
    >(`SELECT id, name, kind, created_at FROM participants WHERE key_hash = ?`)
    .get(hash);
}

export function getParticipantByName(name: string) {
  return db
    .prepare<
      [string],
      { id: string; name: string; kind: "human" | "agent"; created_at: number }
    >(`SELECT id, name, kind, created_at FROM participants WHERE name = ?`)
    .get(name);
}

export function insertParticipant(
  id: string,
  name: string,
  kind: "human" | "agent",
  keyHash: string,
  createdAt: number,
): void {
  db.prepare(
    `INSERT INTO participants (id, name, kind, key_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, name, kind, keyHash, createdAt);
}