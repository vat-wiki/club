import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ulid } from "ulid";
import { escapeLike } from "@club/shared";

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
// have these tables, and re-running the statements is a no-op for them. Exported
// so the migration test can stand up a "v0" db on an arbitrary connection and
// then drive the upgrade chain.
export const BASELINE_SCHEMA = `
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
`;
db.exec(BASELINE_SCHEMA);

// NOTE: `idx_messages_room_created` is defined in migration v11 (it depends on
// the `room` column added in v7). It is not in BASELINE_SCHEMA because v0
// predates multi-room; a fresh database walks the migration chain to reach v11.
// Duplicate `CREATE INDEX IF NOT EXISTS` calls are idempotent, so re-running v11
// on a database that already has the index is a no-op.

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
  {
    version: 4,
    description: "message reply-to (threaded quotes)",
    sql: `ALTER TABLE messages ADD COLUMN reply_to_id TEXT;`,
  },
  {
    version: 5,
    description: "soft-delete (recall) flag on messages",
    sql: `ALTER TABLE messages ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    version: 6,
    description: "emoji reactions on messages",
    sql: `
      CREATE TABLE IF NOT EXISTS reactions (
        message_id     TEXT NOT NULL REFERENCES messages(id),
        participant_id TEXT NOT NULL REFERENCES participants(id),
        emoji          TEXT NOT NULL,
        UNIQUE(message_id, participant_id, emoji)
      );
    `,
  },
  {
    version: 7,
    description: "multi-room: rooms table, messages.room, mentions.room, general seed",
    // Open-topic rooms. `rooms` holds the canonical slug registry; `messages`
    // and `mentions` get a `room` column defaulting to "general" so existing
    // rows backfill in place (zero data loss, no backfill script — NF1). An
    // index on (room) backs the room-scoped history pagination; the cursor
    // stays the monotonic implicit rowid (selectable but not itself indexable
    // as a named column), with the room index narrowing each page's scan. The
    // "general" system row is seeded so it always exists; it is never deleted.
    sql: `
      CREATE TABLE IF NOT EXISTS rooms (
        id          TEXT PRIMARY KEY,
        slug        TEXT NOT NULL UNIQUE,
        created_at  INTEGER NOT NULL
      );
      ALTER TABLE messages ADD COLUMN room TEXT NOT NULL DEFAULT 'general';
      CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room);
      ALTER TABLE mentions ADD COLUMN room TEXT NOT NULL DEFAULT 'general';
      INSERT OR IGNORE INTO rooms (id, slug, created_at)
        VALUES ('general', 'general', CAST(strftime('%s','now') AS INTEGER) * 1000);
    `,
  },
  {
    version: 8,
    description: "filename on uploaded files (document attachments show it)",
    sql: `ALTER TABLE files ADD COLUMN filename TEXT;`,
  },
  {
    version: 9,
    description: "drop participant.kind (category-blind: human/agent distinction removed)",
    // club no longer classifies participants into human/agent — see
    // .pd-docs/requirements/category-blind.md. The column is dropped; every
    // prepared statement has stopped selecting it. BASELINE_SCHEMA still creates
    // the column so a fresh db walks the same v1→v9 path as an upgraded one
    // (create-then-drop is idempotent under the versioned runner, and re-running
    // v9 on a db that already dropped it is skipped by the version check).
    // SQLite ≥3.35 supports DROP COLUMN; better-sqlite3 bundles it.
    sql: `ALTER TABLE participants DROP COLUMN kind;`,
  },
  {
    version: 10,
    description: "index reactions on message_id for lookups and fan-out",
    // `getReactionsForMessage`, `getReactionsForMessages`, and `toggleReaction`
    // all query `reactions` by `message_id`. Without this index every read does a
    // full table scan — linear in total reaction count. As the room ages the
    // reactions table grows faster than the messages table (multiple reactions
    // per message), so the read path for history/stream was the hidden N-per-row
    // cost. The index lets every reaction lookup become a constant-time index
    // seek; the existing UNIQUE(message_id, participant_id, emoji) already
    // prevents duplicate entries, so this secondary index is cheap to maintain.
    sql: `CREATE INDEX IF NOT EXISTS idx_reactions_message_id ON reactions(message_id);`,
  },
  {
    version: 11,
    description:
      "performance: participants lookup indexes (key_hash, name) + compound (room, created_at) index",
    // Better-sqlite3 prepared statements in db.ts issue single-row lookups by
    // key_hash and name on every auth + mention-parse path. Without a secondary
    // index on those columns each lookup is a full-table scan (linear in
    // participant count). For a chat product with small rosters this is
    // invisible, but it keeps the read path O(1) as the deployment grows.
    // The compound (room, created_at) index lets chronological room history
    // scans avoid the (room, rowid) fallback on older SQLite / better-sqlite3
    // builds that can't combine the room index with the rowid cursor in one
    // seek.
    sql: `
      CREATE INDEX IF NOT EXISTS idx_participants_key_hash ON participants(key_hash);
      CREATE INDEX IF NOT EXISTS idx_participants_name     ON participants(name);
      CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages(room, created_at);
    `,
  },
];

db.exec(`
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);
`);

// Apply pending migrations to a connection, tracking the high-water mark in the
// single-row schema_version table. Each migration runs inside a transaction
// (atomic DDL+version bump). `maxVersion` is a test seam letting a caller build
// a db at an older schema (e.g. v6) and then drive the upgrade; production
// leaves it at the default (Infinity → apply everything pending).
export function runMigrations(
  database: Database.Database,
  maxVersion = Infinity,
): void {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL
      );
    `);
    // Seed the version row at 0 the first time (baseline schema above is "v0").
    database
      .prepare(`INSERT OR IGNORE INTO schema_version (version) VALUES (0)`)
      .run();

    const currentVersion = (
      database
        .prepare<[], { version: number }>(`SELECT version FROM schema_version`)
        .get() ?? { version: 0 }
    ).version;

    for (const m of migrations) {
      if (m.version > maxVersion) break;
      if (m.version <= currentVersion) continue;
      const tx = database.transaction(() => {
        database.exec(m.sql);
        database.prepare(`UPDATE schema_version SET version = ?`).run(m.version);
      });
      tx();
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`database migration failed: ${msg}`);
  }
}

runMigrations(db);

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
  attachments: string | null; // JSON-encoded MessageAttachment[]; NULL/"" = none
  reply_to_id: string | null; // id of the message this one replies to, or NULL
  deleted: number; // 1 if recalled (soft-deleted), else 0
  room: string; // canonical room slug; "general" for backfilled rows
}

// Shared SELECT fragment + JOIN for every messages↔participants projection.
// A single constant so adding a column (e.g. a future status field) requires
// one edit rather than hunting six prepared statements for stale aliases.
// Consumers compose it with their own WHERE / ORDER BY / LIMIT clauses.
const messageProjectionSql =
  "SELECT m.id, m.content, m.created_at, m.rowid, m.attachments, m.reply_to_id, m.deleted, m.room, " +
  "       p.id AS participant_id, p.name AS author_name FROM messages m JOIN participants p ON p.id = m.participant_id";

const insertMessageStmt = db.prepare(
  `INSERT INTO messages (id, participant_id, content, created_at, attachments, reply_to_id, room)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);

export function insertMessage(
  id: string,
  participantId: string,
  content: string,
  createdAt: number,
  attachments: string | null,
  replyToId: string | null,
  room: string,
): void {
  insertMessageStmt.run(id, participantId, content, createdAt, attachments, replyToId, room);
}

const allParticipantsSelectStmt = db.prepare<[], { id: string; name: string; created_at: number }>(
  `SELECT id, name, created_at FROM participants ORDER BY created_at ASC`,
);

export function getAllParticipants(): { id: string; name: string; created_at: number }[] {
  return allParticipantsSelectStmt.all();
}

const afterStmt = db.prepare<[number, string, number], MessageRow>(
  `${messageProjectionSql} WHERE m.rowid > ? AND m.room = ? ORDER BY m.rowid ASC LIMIT ?`,
);

const recentStmt = db.prepare<[string, number], MessageRow>(
  `${messageProjectionSql} WHERE m.room = ? ORDER BY m.rowid DESC LIMIT ?`,
);

const sinceStmt = db.prepare<[string], { rowid: number }>(
  `SELECT rowid FROM messages WHERE id = ?`,
);

const sinceMessagesStmt = db.prepare<[number, string, number], MessageRow>(
  `${messageProjectionSql} WHERE m.rowid > ? AND m.room = ? ORDER BY m.rowid ASC LIMIT ?`,
);

export function getMessagesAfter(rowid: number, room: string, limit: number): MessageRow[] {
  return afterStmt.all(rowid, room, limit);
}

export function getRecentMessages(room: string, limit: number): MessageRow[] {
  return recentStmt.all(room, limit).reverse();
}

export function getMessagesSince(
  sinceId: string,
  room: string,
  limit: number,
): { rowid: number; messages: MessageRow[] } {
  const row = sinceStmt.get(sinceId);
  if (!row) return { rowid: 0, messages: [] as MessageRow[] };
  return { rowid: row.rowid, messages: sinceMessagesStmt.all(row.rowid, room, limit) };
}

const beforeStmt = db.prepare<[number, string, number], MessageRow>(
  `${messageProjectionSql} WHERE m.rowid < ? AND m.room = ? ORDER BY m.rowid DESC LIMIT ?`,
);

/** Messages older than `beforeId`, chronologic (oldest→newest within the page).
 *  Backs the "scroll up to load earlier history" UI — the mirror of
 *  getMessagesSince: take the N rows with rowid < beforeId's (DESC to grab the
 *  nearest older ones), then reverse to ascending. Returns [] if beforeId is
 *  unknown (e.g. it was just deleted). Scoped to `room`. */
export function getMessagesBeforeId(beforeId: string, room: string, limit: number): MessageRow[] {
  const row = sinceStmt.get(beforeId);
  if (!row) return [];
  return beforeStmt.all(row.rowid, room, limit).reverse();
}

const searchAllStmt = db.prepare<[string, number], MessageRow>(
  `${messageProjectionSql} WHERE m.content LIKE ? ESCAPE '\\\\' ORDER BY m.rowid DESC LIMIT ?`,
);

const searchRoomStmt = db.prepare<[string, string, number], MessageRow>(
  `${messageProjectionSql} WHERE m.content LIKE ? ESCAPE '\\\\' AND m.room = ? ORDER BY m.rowid DESC LIMIT ?`,
);

/** Messages whose content contains `q` (substring via LIKE), newest first.
 *  Backs the search box. When `room` is null/empty the search spans all rooms;
 *  otherwise it is scoped to that room.
 *
 *  The user-supplied `q` is escaped so `%` / `_` / `\\` are treated as
 *  literal characters (no LIKE wildcard injection).
 */
export function searchMessages(q: string, room: string | null, limit: number): MessageRow[] {
  const escaped = `%${escapeLike(q)}%`;
  return room ? searchRoomStmt.all(escaped, room, limit) : searchAllStmt.all(escaped, limit);
}

// The room a message lives in. Used to room-scope `message_deleted` /
// `message_reaction` SSE fan-out (the delete/reaction routes know only the id,
// and a message's room never changes). Returns undefined if the id is unknown.
const messageRoomStmt = db.prepare<[string], { room: string }>(
  `SELECT room FROM messages WHERE id = ?`,
);
export function getMessageRoom(id: string): string | undefined {
  return messageRoomStmt.get(id)?.room;
}

const deleteStmt = db.prepare<[string, string]>(
  `UPDATE messages SET deleted = 1 WHERE id = ? AND participant_id = ? AND deleted = 0`,
);

/** Soft-delete (recall) a message. Only the author may (participant_id check).
 *  Returns whether a row was actually updated — false means not found, not
 *  yours, or already recalled. */
export function deleteMessage(id: string, participantId: string): boolean {
  return deleteStmt.run(id, participantId).changes > 0;
}

const removeReactionStmt = db.prepare<[string, string, string]>(
  `DELETE FROM reactions WHERE message_id = ? AND participant_id = ? AND emoji = ?`,
);
const addReactionStmt = db.prepare<[string, string, string]>(
  `INSERT OR IGNORE INTO reactions (message_id, participant_id, emoji) VALUES (?, ?, ?)`,
);
const reactionsForMsgStmt = db.prepare<[string], { emoji: string; participant_id: string }>(
  `SELECT emoji, participant_id FROM reactions WHERE message_id = ?`,
);

/** Aggregate reactions on a message (emoji → count). */
export function getReactionsForMessage(messageId: string): { emoji: string; count: number }[] {
  const rows = reactionsForMsgStmt.all(messageId);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
  return [...counts.entries()].map(([emoji, count]) => ({ emoji, count }));
}

/** Batch-fetch reactions for multiple messages in a single query.
 *  Returns a Map<message_id, Reaction[]> keyed by the ids that had reactions.
 *
 *  Performance: the SELECT statement is cached per placeholder count rather
 *  than recreated per call. Reactions are queried frequently during history
 *  renders (a list of messages), so a one-time-allocated statement per batch
 *  size avoids repeated statement creation on the hot path.
 */
const reactionsForMessagesCache = new Map<number, ReturnType<typeof db.prepare<[...string[]], { message_id: string; emoji: string; participant_id: string }>>>();

export function getReactionsForMessages(
  messageIds: string[],
): Map<string, { emoji: string; count: number }[]> {
  if (messageIds.length === 0) return new Map();
  const placeholders = "?,".repeat(messageIds.length).slice(0, -1);
  let stmt = reactionsForMessagesCache.get(messageIds.length);
  if (!stmt) {
    const sql = `SELECT message_id, emoji, participant_id FROM reactions WHERE message_id IN (${placeholders})`;
    stmt = db.prepare<[...string[]], { message_id: string; emoji: string; participant_id: string }>(sql);
    reactionsForMessagesCache.set(messageIds.length, stmt);
  }
  const rows = stmt.all(...messageIds as [...string[]]);
  const byMsg = new Map<string, Map<string, number>>();
  for (const r of rows) {
    let counts = byMsg.get(r.message_id);
    if (!counts) {
      counts = new Map<string, number>();
      byMsg.set(r.message_id, counts);
    }
    counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
  }
  const out = new Map<string, { emoji: string; count: number }[]>();
  for (const [msgId, counts] of byMsg) {
    out.set(msgId, [...counts.entries()].map(([emoji, count]) => ({ emoji, count })));
  }
  return out;
}

/** Toggle a reaction (remove if present, add if absent). Returns the refreshed
 *  aggregate so the caller can broadcast it. */
export function toggleReaction(messageId: string, participantId: string, emoji: string): { emoji: string; count: number }[] {
  const removed = removeReactionStmt.run(messageId, participantId, emoji).changes > 0;
  if (!removed) addReactionStmt.run(messageId, participantId, emoji);
  return getReactionsForMessage(messageId);
}

const participantByKeyHashStmt = db.prepare<
  [string],
  { id: string; name: string; created_at: number }
>(`SELECT id, name, created_at FROM participants WHERE key_hash = ?`);

export function getParticipantByKeyHash(hash: string) {
  return participantByKeyHashStmt.get(hash);
}

const participantByNameStmt = db.prepare<
  [string],
  { id: string; name: string; created_at: number }
>(`SELECT id, name, created_at FROM participants WHERE name = ?`);

export function getParticipantByName(name: string) {
  return participantByNameStmt.get(name);
}

const insertParticipantStmt = db.prepare(
  `INSERT INTO participants (id, name, key_hash, recover_hash, created_at)
   VALUES (?, ?, ?, ?, ?)`,
);

export function insertParticipant(
  id: string,
  name: string,
  keyHash: string,
  recoverHash: string,
  createdAt: number,
): void {
  insertParticipantStmt.run(id, name, keyHash, recoverHash, createdAt);
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
  created_at: number;
  recover_hash: string | null;
}

const getParticipantForRecoverStmt = db.prepare<
  [string],
  ParticipantRecoverRow
>(`SELECT id, name, created_at, recover_hash FROM participants WHERE name = ?`);

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
  content: string;
  message_created_at: number;
  read_at: number | null;
  room: string; // room the mentioning message was posted in (deep-link source)
}

const allParticipantsStmt = db.prepare<
  [],
  { id: string; name: string }
>(`SELECT id, name FROM participants`);

/** Lightweight roster for mention parsing: every (id, name). */
export function getAllParticipantNames(): { id: string; name: string }[] {
  return allParticipantsStmt.all().map((r) => ({ id: r.id, name: r.name }));
}

const insertMentionStmt = db.prepare(
  `INSERT OR IGNORE INTO mentions
     (id, message_id, participant_id, author_id, room, read_at, created_at)
   VALUES (?, ?, ?, ?, ?, NULL, ?)`,
);

/**
 * Insert one inbox row. `INSERT OR IGNORE` so a duplicate (same message +
 * recipient) is silently dropped rather than throwing — matches the UNIQUE
 * constraint intent. Returns whether a row was actually inserted. `room` is the
 * room the mentioning message was posted in, so the recipient can deep-link.
 */
export function insertMention(
  id: string,
  messageId: string,
  participantId: string,
  authorId: string,
  room: string,
  createdAt: number,
): boolean {
  return insertMentionStmt.run(id, messageId, participantId, authorId, room, createdAt)
    .changes > 0;
}

const unreadMentionsStmt = db.prepare<[string, number], MentionRow>(
  `SELECT mn.id, mn.message_id, mn.participant_id, mn.author_id,
           p.name AS author_name,
           m.content AS content, m.created_at AS message_created_at,
           mn.read_at, mn.room
    FROM mentions mn
    JOIN messages m ON m.id = mn.message_id
    JOIN participants p ON p.id = mn.author_id
    WHERE mn.participant_id = ? AND mn.read_at IS NULL
    ORDER BY m.created_at ASC LIMIT ?`,
);

/** Unread mentions for `participantId`, oldest first, capped at `limit`. */
export function getUnreadMentions(participantId: string, limit = 100): MentionRow[] {
  return unreadMentionsStmt.all(participantId, limit);
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
          p.name AS author_name,
          m.content AS content, m.created_at AS message_created_at,
          mn.read_at, mn.room
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
  filename: string | null;
}

const insertFileStmt = db.prepare(
  `INSERT INTO files (id, participant_id, mime, width, height, size, created_at, filename)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);

export function insertFile(f: FileRow): void {
  insertFileStmt.run(
    f.id,
    f.participant_id,
    f.mime,
    f.width,
    f.height,
    f.size,
    f.created_at,
    f.filename,
  );
}

const fileByIdStmt = db.prepare<[string], FileRow>(
  `SELECT id, participant_id, mime, width, height, size, created_at, filename
   FROM files WHERE id = ?`,
);

export function getFile(id: string): FileRow | undefined {
  return fileByIdStmt.get(id);
}

// Fetch several files by id, preserving the requested order. Used by
// POST /messages to rehydrate attachments from the client's `attachmentIds` —
// order matters so the message shows images in the order the user picked them.
//
// Performance: the SELECT statement is cached per placeholder count rather than
// recreated per call. Each batch size gets one prepared statement (mirroring the
// cached participantByKeyHashStmt / participantByNameStmt pattern) — avoids
// repeatedly allocating statement objects for identical SQL across hot-path
// requests. better-sqlite3 also caches by SQL string internally, but an explicit
// cache keeps the statement alive across requests and makes the intent clear.
const fileGetByIdsCache = new Map<number, ReturnType<typeof db.prepare<[...string[]], FileRow>>>();
// Note: we cannot pre-build the SQL at module scope with a variable placeholder
// count, so the cache is keyed by count and built lazily. The per-call overhead
// is a Map.get + a one-time prepare per batch size.

export function getFilesByIds(ids: string[]): FileRow[] {
  if (ids.length === 0) return [];
  if (ids.length > 100) {
    // Defensive: a message shouldn't reference this many files. This protects
    // against pathological abuse while staying far above legitimate limits.
    throw new Error("too many file ids requested (max 100)");
  }
  const placeholders = "?,".repeat(ids.length).slice(0, -1);
  let stmt = fileGetByIdsCache.get(ids.length);
  if (!stmt) {
    const sql =
      `SELECT id, participant_id, mime, width, height, size, created_at, filename
       FROM files WHERE id IN (${placeholders})`;
    stmt = db.prepare<[...string[]], FileRow>(sql);
    fileGetByIdsCache.set(ids.length, stmt);
  }
  const byId = new Map<string, FileRow>();
  const rows = stmt.all(...ids as [...string[]]);
  for (const row of rows) {
    byId.set(row.id, row);
  }
  return ids.map((id) => byId.get(id)).filter((r): r is FileRow => r !== undefined);
}

// ── Rooms (multi-room) ───────────────────────────────────────────────
//
// Rooms are open topic channels (PRD §4.1). The `rooms` table is the canonical
// slug registry; messages/mentions carry the slug directly (no FK by design —
// a room's slug is immutable and stable, and messages may reference a room
// before its registry row is observably present in a race, though in practice
// POST /messages ensures the room exists first). `general` is the seeded system
// row and is always present.

export interface RoomRow {
  id: string;
  slug: string;
  created_at: number;
  // created_at of the most recent message in this room; NULL for an empty room.
  last_activity_at: number | null;
}

// All rooms with their last-activity timestamp in one scan. `general` sorts
// first, then most-recently-active first, then empty rooms (NULL activity) last
// by created_at. The LEFT JOIN + MAX yields NULL activity for rooms with no
// messages — exactly what clients need for "active-first" ordering without a
// second round-trip. Room counts are small (<100 expected), so the grouped scan
// is plenty fast.
const listRoomsStmt = db.prepare<[], RoomRow>(
  `SELECT r.id, r.slug, r.created_at,
          MAX(m.created_at) AS last_activity_at
   FROM rooms r
   LEFT JOIN messages m ON m.room = r.slug
   GROUP BY r.id, r.slug, r.created_at
   ORDER BY (r.slug = 'general') DESC, last_activity_at DESC, r.created_at ASC`,
);
export function listRooms(): RoomRow[] {
  return listRoomsStmt.all();
}

const roomBySlugStmt = db.prepare<
  [string],
  { id: string; slug: string; created_at: number }
>(`SELECT id, slug, created_at FROM rooms WHERE slug = ?`);

const insertRoomStmt = db.prepare(
  `INSERT OR IGNORE INTO rooms (id, slug, created_at) VALUES (?, ?, ?)`,
);

/** Ensure a room with `slug` exists, creating it if missing. Idempotent: a
 *  pre-check returns the existing row; INSERT OR IGNORE guards the rare race of
 *  two concurrent creates. Returns the room plus `created` (true iff this call
 *  actually inserted the row) so the route can pick 201 vs 200. */
export function ensureRoom(
  slug: string,
  createdAt: number,
): { id: string; slug: string; created_at: number; created: boolean } {
  const existing = roomBySlugStmt.get(slug);
  if (existing) return { ...existing, created: false };
  const id = ulid();
  insertRoomStmt.run(id, slug, createdAt);
  return { id, slug, created_at: createdAt, created: true };
}