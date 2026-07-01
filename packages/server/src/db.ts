import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const dbPath = process.env.CLUB_DB ?? resolve(process.cwd(), "club.db");

// Ensure the parent dir exists (hidden ENV var to relocate the sqlite file).
if (!existsSync(dirname(dbPath))) mkdirSync(dirname(dbPath), { recursive: true });

export const db: Database.Database = new Database(dbPath);
db.pragma("journal_mode = WAL");
// Codify what is currently better-sqlite3's compile-time default
// (DEFAULT_FOREIGN_KEYS): foreign-key enforcement ON. The messages/files →
// participants FKs rely on this. Without the explicit pragma, a future
// better-sqlite3 build that drops that flag would silently stop enforcing
// them. No-op today (the default already enables it); explicit for
// upgrade-safety and to document intent.
db.pragma("foreign_keys = ON");

// Baseline schema: participants + messages, created with CREATE TABLE IF NOT
// EXISTS since the very first release. We keep this as-is (idempotent) rather
// than retrofitting it into the migration list — existing deployments already
// have these tables, and re-running the statements is a no-op for them.
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

// ── Schema migrations ─────────────────────────────────────────────────
// A tiny, dependency-free migration runner. Each migration is an ordered DDL
// block identified by an integer version; we track the highest applied
// version in a single-row `schema_version` table and apply anything newer
// inside a transaction at startup. This is intentionally lighter than a full
// migration framework (no up/down, no SQL files) — it matches the project's
// "no entity without need" stance while unblocking safe schema evolution.
//
// Add new migrations by appending to the array; never edit or reorder an
// already-shipped migration.
type Migration = { version: number; description: string; sql: string };
const migrations: Migration[] = [
  {
    version: 1,
    description: "mentions table (per-participant @-mention inbox)",
    // One row per (message, mentioned participant). UNIQUE(message_id,
    // participant_id) prevents duplicate inbox entries if a message @-mentions
    // the same participant twice in its text. read_at is NULL until the
    // recipient marks it read; an index on (participant_id, read_at) backs the
    // unread-inbox query.
    sql: `
      CREATE TABLE IF NOT EXISTS mentions (
        id             TEXT PRIMARY KEY,
        message_id     TEXT NOT NULL REFERENCES messages(id),
        participant_id TEXT NOT NULL REFERENCES participants(id),
        author_id      TEXT NOT NULL REFERENCES participants(id),
        read_at        INTEGER,
        created_at     INTEGER NOT NULL,
        UNIQUE(message_id, participant_id)
      );
      CREATE INDEX IF NOT EXISTS idx_mentions_unread
        ON mentions(participant_id, read_at, created_at);
    `,
  },
  {
    version: 2,
    description: "identity recovery: per-participant recover_hash",
    // nullable recover_hash: NULL means the participant has no recovery code
    // set yet (pre-recovery-deployment participants, or a freshly rotated code
    // whose plaintext has already been returned once). sha256(plaintext
    // recovery code); the plaintext is never stored, mirroring key_hash.
    sql: `
      ALTER TABLE participants ADD COLUMN recover_hash TEXT;
    `,
  },
  {
    version: 3,
    description: "image attachments on messages + uploaded-file metadata",
    // `attachments` is a JSON column (NULL/empty = no images) rather than a
    // separate table: attachments are never queried independently — they're
    // always read alongside their message — so a join table would be entity
    // without need. `files` records upload metadata so the server is the sole
    // source of truth for mime/width/height/size and can rehydrate attachments
    // from just the `id`s a client sends with POST /messages (dimensions can't
    // be forged). The `id` doubles as the public /files/{id} path.
    sql: `
      ALTER TABLE messages ADD COLUMN attachments TEXT;
      CREATE TABLE IF NOT EXISTS files (
        id             TEXT PRIMARY KEY,
        participant_id TEXT NOT NULL REFERENCES participants(id),
        mime           TEXT NOT NULL,
        width          INTEGER,
        height         INTEGER,
        size           INTEGER NOT NULL,
        created_at     INTEGER NOT NULL
      );
    `,
  },
];

db.exec(`
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);
`);
// Seed the version row at 0 the first time (baseline schema above is "v0").
db.prepare(
  `INSERT OR IGNORE INTO schema_version (version) VALUES (0)`,
).run();

const currentVersion = (
  db
    .prepare<[], { version: number }>(`SELECT version FROM schema_version`)
    .get() ?? { version: 0 }
).version;

for (const m of migrations) {
  if (m.version <= currentVersion) continue;
  const tx = db.transaction(() => {
    db.exec(m.sql);
    db.prepare(`UPDATE schema_version SET version = ?`).run(m.version);
  });
  tx();
}

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
  attachments: string | null; // JSON-encoded MessageAttachment[]; NULL/"" = none
}

export function insertMessage(
  id: string,
  participantId: string,
  content: string,
  createdAt: number,
  attachments: string | null,
): void {
  db.prepare(
    `INSERT INTO messages (id, participant_id, content, created_at, attachments)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, participantId, content, createdAt, attachments);
}

export function getAllParticipants() {
  return db
    .prepare<[], { id: string; name: string; kind: "human" | "agent"; created_at: number }>(
      `SELECT id, name, kind, created_at FROM participants ORDER BY created_at ASC`,
    )
    .all();
}

const afterStmt = db.prepare<[number, number], MessageRow>(
  `SELECT m.id, m.content, m.created_at, m.rowid, m.attachments,
          p.id AS participant_id, p.name AS author_name, p.kind AS author_kind
   FROM messages m JOIN participants p ON p.id = m.participant_id
   WHERE m.rowid > ? ORDER BY m.rowid ASC LIMIT ?`,
);

const recentStmt = db.prepare<[number], MessageRow>(
  `SELECT m.id, m.content, m.created_at, m.rowid, m.attachments,
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
  recoverHash: string,
  createdAt: number,
): void {
  db.prepare(
    `INSERT INTO participants (id, name, kind, key_hash, recover_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, name, kind, keyHash, recoverHash, createdAt);
}

// ── Identity recovery ───────────────────────────────────────────────
// Recovery works by callsign + one-time recovery code. On a successful
// recovery the server reissues BOTH a fresh key (key_hash rotated) and a fresh
// recovery code (recover_hash rotated) — see PRD identity-recovery.md §5.4 /
// §8.1 ("换发新恢复码"). recover_hash is nullable: NULL means "no recovery
// code currently active" (old participants predating the feature, or after a
// successful recovery until the new code's hash is written).

export interface ParticipantRecoverRow {
  id: string;
  name: string;
  kind: "human" | "agent";
  created_at: number;
  recover_hash: string | null;
}

const getParticipantForRecoverStmt = db.prepare<
  [string],
  ParticipantRecoverRow
>(`SELECT id, name, kind, created_at, recover_hash FROM participants WHERE name = ?`);

/** A participant row including recover_hash, looked up by callsign (for the
 *  recovery endpoint). Returns undefined if the name doesn't exist. */
export function getParticipantForRecover(name: string): ParticipantRecoverRow | undefined {
  return getParticipantForRecoverStmt.get(name);
}

const updateParticipantKeyStmt = db.prepare(
  `UPDATE participants SET key_hash = ? WHERE id = ?`,
);

/** Rotate the participant's key (recovery flow). Idempotent at the row level. */
export function updateParticipantKey(id: string, newKeyHash: string): void {
  updateParticipantKeyStmt.run(newKeyHash, id);
}

const updateParticipantRecoverStmt = db.prepare(
  `UPDATE participants SET recover_hash = ? WHERE id = ?`,
);

/** Set the participant's recover_hash. Pass null to clear (invalidate) it,
 *  or a sha256 hex string to arm a new recovery code. */
export function updateParticipantRecover(id: string, newHash: string | null): void {
  updateParticipantRecoverStmt.run(newHash, id);
}

// ── Mentions (per-participant @-mention inbox) ──────────────────────

export interface MentionRow {
  id: string;
  message_id: string;
  participant_id: string;
  author_id: string;
  author_name: string;
  author_kind: "human" | "agent";
  content: string;
  message_created_at: number;
  read_at: number | null;
}

const allParticipantsStmt = db.prepare<
  [],
  { id: string; name: string; kind: "human" | "agent" }
>(`SELECT id, name, kind FROM participants`);

/** Lightweight roster for mention parsing: every (id, name). */
export function getAllParticipantNames(): { id: string; name: string }[] {
  return allParticipantsStmt.all().map((r) => ({ id: r.id, name: r.name }));
}

const insertMentionStmt = db.prepare(
  `INSERT OR IGNORE INTO mentions
     (id, message_id, participant_id, author_id, read_at, created_at)
   VALUES (?, ?, ?, ?, NULL, ?)`,
);

/**
 * Insert one inbox row. `INSERT OR IGNORE` so a duplicate (same message +
 * recipient) is silently dropped rather than throwing — matches the UNIQUE
 * constraint intent. Returns whether a row was actually inserted.
 */
export function insertMention(
  id: string,
  messageId: string,
  participantId: string,
  authorId: string,
  createdAt: number,
): boolean {
  return insertMentionStmt.run(id, messageId, participantId, authorId, createdAt)
    .changes > 0;
}

const unreadMentionsStmt = db.prepare<[string], MentionRow>(
  `SELECT mn.id, mn.message_id, mn.participant_id, mn.author_id,
          p.name AS author_name, p.kind AS author_kind,
          m.content AS content, m.created_at AS message_created_at,
          mn.read_at
   FROM mentions mn
   JOIN messages m ON m.id = mn.message_id
   JOIN participants p ON p.id = mn.author_id
   WHERE mn.participant_id = ? AND mn.read_at IS NULL
   ORDER BY m.created_at ASC`,
);

/** Unread mentions for `participantId`, oldest first. */
export function getUnreadMentions(participantId: string): MentionRow[] {
  return unreadMentionsStmt.all(participantId);
}

const mentionByIdStmt = db.prepare<
  [string],
  { id: string; participant_id: string; read_at: number | null }
>(`SELECT id, participant_id, read_at FROM mentions WHERE id = ?`);

/** A single mention row, or undefined. Only the fields the caller needs. */
export function getMentionById(id: string) {
  return mentionByIdStmt.get(id);
}

const mentionFullStmt = db.prepare<[string], MentionRow>(
  `SELECT mn.id, mn.message_id, mn.participant_id, mn.author_id,
          p.name AS author_name, p.kind AS author_kind,
          m.content AS content, m.created_at AS message_created_at,
          mn.read_at
   FROM mentions mn
   JOIN messages m ON m.id = mn.message_id
   JOIN participants p ON p.id = mn.author_id
   WHERE mn.id = ?`,
);

/** A single mention, fully joined (author + message content) for display. */
export function getMentionFull(id: string): MentionRow | undefined {
  return mentionFullStmt.get(id);
}

const markReadStmt = db.prepare(
  `UPDATE mentions SET read_at = ? WHERE id = ? AND read_at IS NULL`,
);

/**
 * Mark one mention read. Returns whether a row was actually updated (false if
 * it didn't exist or was already read). `readAt` is taken as a parameter so
 * callers/tests can pin the timestamp.
 */
export function markMentionRead(id: string, readAt: number): boolean {
  return markReadStmt.run(readAt, id).changes > 0;
}

// ── Uploaded files (image metadata) ──────────────────────────────────

// The DB row for an uploaded image. `id` doubles as the public /files/{id}
// path; `participant_id` is the uploader, checked at POST /messages time so a
// sender can only attach files it uploaded (not another participant's).
export interface FileRow {
  id: string;
  participant_id: string;
  mime: string;
  width: number | null;
  height: number | null;
  size: number;
  created_at: number;
}

const insertFileStmt = db.prepare(
  `INSERT INTO files (id, participant_id, mime, width, height, size, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);

export function insertFile(f: Omit<FileRow, never>): void {
  insertFileStmt.run(
    f.id,
    f.participant_id,
    f.mime,
    f.width,
    f.height,
    f.size,
    f.created_at,
  );
}

const fileByIdStmt = db.prepare<[string], FileRow>(
  `SELECT id, participant_id, mime, width, height, size, created_at
   FROM files WHERE id = ?`,
);

export function getFile(id: string): FileRow | undefined {
  return fileByIdStmt.get(id);
}

// Fetch several files by id, preserving the requested order. Used by
// POST /messages to rehydrate attachments from the client's `attachmentIds` —
// order matters so the message shows images in the order the user picked them.
export function getFilesByIds(ids: string[]): FileRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare<string[], FileRow>(
      `SELECT id, participant_id, mime, width, height, size, created_at
       FROM files WHERE id IN (${placeholders})`,
    )
    .all(...ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Filter undefined (id not found) but keep order; caller validates ownership.
  return ids.map((id) => byId.get(id)).filter((r): r is FileRow => !!r);
}