/**
 * @module club-serve/db
 *
 * SQLite data-access layer for the club backend. All read/write paths —
 * messages, participants, channels, reactions, mentions, files — flow through the
 * exported functions in this module. HTTP routes, CLI, and MCP only import from
 * here; no caller should reach into `db` directly.
 *
 * Conventions:
 *
 * - **Single shared projection.** Every messages query composes from
 *   {@link messageProjectionSql}, so adding a column to the SELECT requires
 *   one edit rather than hunting six prepared statements.
 * - **Cursor by rowid.** Pagination uses the monotonic SQLite `rowid` rather
 *   than the ULID `id`, so history walks stay correct even when clocks skew.
 *   ULID → rowid resolution is itself cached in {@link sinceStmt}.
 * - **Soft-delete.** `messages.deleted` is a 1/0 flag; recalled messages stay
 *   in the table and are filtered at the query layer. Row-level auth (the
 *   caller must be the author) guards the recall path.
 * - **Cache invalidate hooks.** Frequent-read tables (participants, channels)
 *   are cached in JS. Callers that mutate those tables must call the
 *   corresponding `invalidate*Cache` function immediately after the write.
 * - **Idempotent writes.** `insertParticipant`, `ensureChannel`, key/recover
 *   rotations use `INSERT OR REPLACE` / `UPDATE WHERE EXISTS` so retry-safe
 *   callers (recovery flows) can't double-create rows.
 *
 * Schema lives in {@link BASELINE_SCHEMA} (v0) and the `migrations` array
 * (v1–v11). {@link runMigrations} walks the chain on module load. Exported
 * for migration tests that stand up a fresh connection.
 *
 * Row interfaces ({@link MessageRow}, {@link ParticipantRow},
 * {@link ParticipantRecoverRow}, {@link MentionRow}, {@link MentionByIdRow},
 * {@link MentionInsert}, {@link FileRow}, {@link ChannelRow}) mirror the SQLite
 * column set exactly so callers never carry implicit shape knowledge.
 *
 * @example
 * ```ts
 * import { insertMessage, getMessagesSince, getAllParticipants } from "./db.js";
 *
 * insertMessage(id, authorId, "hi", Date.now(), null, null, "general");
 * const { rowid, messages } = getMessagesSince(lastId, "general", 50);
 * ```
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { ulid } from 'ulid';

import { type ChannelSlugType,escapeLike, type Reaction } from '@club/shared';

const dbPath = process.env.CLUB_DB ?? resolve(process.cwd(), 'club.db');

// Ensure the parent dir exists (hidden ENV var to relocate the sqlite file).
if (!existsSync(dirname(dbPath))) mkdirSync(dirname(dbPath), { recursive: true });

export const db: Database.Database = new Database(dbPath);
db.pragma('journal_mode = WAL');
// Codify what is currently better-sqlite3's compile-time default
// (DEFAULT_FOREIGN_KEYS): foreign-key enforcement ON. The messages/files →
// participants FKs rely on this. Without the explicit pragma, a future
// better-sqlite3 build that drops that flag would silently stop enforcing
// them. No-op today (the default already enables it); explicit for
// upgrade-safety and to document intent.
db.pragma('foreign_keys = ON');

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
    description: 'mentions table (per-participant @-mention inbox)',
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
    description: 'identity recovery: per-participant recover_hash',
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
    description: 'image attachments on messages + uploaded-file metadata',
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
    description: 'message reply-to (threaded quotes)',
    sql: `ALTER TABLE messages ADD COLUMN reply_to_id TEXT;`,
  },
  {
    version: 5,
    description: 'soft-delete (recall) flag on messages',
    sql: `ALTER TABLE messages ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    version: 6,
    description: 'emoji reactions on messages',
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
    description: 'multi-room: rooms table, messages.room, mentions.room, general seed',
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
    description: 'filename on uploaded files (document attachments show it)',
    sql: `ALTER TABLE files ADD COLUMN filename TEXT;`,
  },
  {
    version: 9,
    description: 'drop participant.kind (category-blind: human/agent distinction removed)',
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
    description: 'index reactions on message_id for lookups and fan-out',
    // `getReactionsForMessage`, `getReactionsForMessages`, and `toggleReaction`
    // all query `reactions` by `message_id`. Without this index every read does a
    // full table scan — linear in total reaction count. As the channel ages the
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
      'performance: participants lookup indexes (key_hash, name) + compound (room, created_at) index',
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
  {
    version: 12,
    description:
      'performance: composite (participant_id, id) index for deleteMessage ownership check',
    // `deleteMessage` issues `UPDATE ... WHERE id = ? AND participant_id = ? AND deleted = 0`
    // to verify the sender owns the message before recall. Without a covering index
    // on (participant_id, id) the ownership check scans the entire messages table,
    // which is linear in message count. The composite index makes the lookup an
    // O(1) index seek; the B-tree on (participant_id, id) also avoids an extra
    // rowid hop since both filtered columns are the key.
    sql: `CREATE INDEX IF NOT EXISTS idx_messages_participant_id_id
           ON messages(participant_id, id);`,
  },
  {
    version: 13,
    description:
      'performance: covering (participant_id, id, deleted) index to eliminate table lookup in deleteMessage ownership check',
    // v12's (participant_id, id) index routes the WHERE to a single B-tree leaf,
    // but `deleted = 0` still requires a rowid → table row fetch (a "keyset" index
    // only avoids the scan, not the rowid hop). Adding `deleted` as the third column
    // makes the index covering: the DELETE can be resolved entirely inside the
    // B-tree, saving one page read per recall. The added column is tiny (INTEGER
    // flag) and matches the existing `deleted INTEGER NOT NULL DEFAULT 0` column.
    sql: `CREATE INDEX IF NOT EXISTS idx_messages_participant_id_id_deleted
           ON messages(participant_id, id, deleted);`,
  },
  {
    version: 14,
    description:
      'message edit tracking: edited_at (timestamp) and edited_count (integer) columns',
    // PATCH /messages/:id advances these two columns. `edited_at` is NULL when
    // the message has never been edited; `edited_count` is 0 at baseline and
    // increments with every successful edit. Backward-compatible: queries that
    // never read these columns are unaffected.
    sql: `
      ALTER TABLE messages ADD COLUMN edited_at   INTEGER DEFAULT NULL;
      ALTER TABLE messages ADD COLUMN edited_count INTEGER DEFAULT 0;
    `,
  },
  {
    version: 15,
    description:
      'participant bio (self-introduction) column - category-blind role description',
    // A free-form, single-line self-introduction each participant writes for
    // themselves - the SAME field for humans and agents (club does not classify
    // participants; see .pd-docs/requirements/category-blind.md). NOT NULL
    // DEFAULT '' so every existing row backfills to "unset" in place (zero data
    // loss, no backfill script), and every read path treats bio as a plain
    // string with no null-handling. Capped at MAX_BIO (200) and stripped of
    // control chars by the shared ParticipantBio schema at ingestion, so the
    // stored value is always single-line.
    sql: `ALTER TABLE participants ADD COLUMN bio TEXT NOT NULL DEFAULT '';`,
  },
  {
    version: 16,
    description: 'rename room -> channel (rooms table, messages.room, mentions.room, indexes)',
    // The domain concept historically named "room" is renamed to "channel"
    // throughout the codebase - a club instance is the "room"; the topic
    // channels within it are channels, not rooms. This migration renames the
    // `rooms` table to `channels` and the `room` column on `messages` and
    // `mentions` to `channel`, and replaces the two room-named indexes with
    // channel-named ones. RENAME TABLE / RENAME COLUMN preserve all data in
    // place (zero data loss, no backfill). SQLite >=3.25 supports RENAME
    // COLUMN; better-sqlite3 bundles 3.49. Historical v7/v11 keep their
    // `room`/`rooms` SQL so the shipped chain is self-consistent; v16 is the
    // cutover.
    sql: `
      ALTER TABLE rooms RENAME TO channels;
      ALTER TABLE messages RENAME COLUMN room TO channel;
      ALTER TABLE mentions RENAME COLUMN room TO channel;
      DROP INDEX IF EXISTS idx_messages_room;
      DROP INDEX IF EXISTS idx_messages_room_created;
      CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
      CREATE INDEX IF NOT EXISTS idx_messages_channel_created ON messages(channel, created_at);
    `,
  },
  {
    version: 17,
    description: 'channel display_name (mutable human label; slug stays the immutable key)',
    // Channels are renamed via a display name rather than by changing the slug,
    // because the slug is the key referenced by messages/SSE/mentions (renaming a
    // slug would require rewriting every reference). display_name is nullable:
    // NULL ⇒ clients render the slug. Existing rows backfill to NULL in place
    // (zero data loss, no backfill script). ADD COLUMN is idempotent under the
    // runner's "duplicate column name" guard.
    sql: `ALTER TABLE channels ADD COLUMN display_name TEXT;`,
  },
  {
    version: 18,
    description: 'participant soft-delete flag (kick/self-delete keeps the account + content, hides from roster)',
    // Removing a participant (kick or self-delete) is a *soft* delete: the row
    // stays so messages still JOIN to a valid author name, but the account is
    // marked deleted so it drops out of the roster / mention set and can no
    // longer authenticate. The participant's authored content (messages,
    // reactions, mentions) is preserved untouched - history stays intact.
    // Existing rows backfill to 0 (active) in place (zero data loss). ADD
    // COLUMN is idempotent under the runner's "duplicate column name" guard.
    sql: `ALTER TABLE participants ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;`,
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
export function runMigrations(database: Database.Database, maxVersion = Infinity): void {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL
      );
    `);
    // Seed the version row at 0 the first time (baseline schema above is "v0").
    database.prepare(`INSERT OR IGNORE INTO schema_version (version) VALUES (0)`).run();

    const currentVersion = (
      database.prepare<[], { version: number }>(`SELECT version FROM schema_version`).get() ?? {
        version: 0,
      }
    ).version;

    for (const m of migrations) {
      if (m.version > maxVersion) break;
      if (m.version <= currentVersion) continue;
      const tx = database.transaction(() => {
        try {
          database.exec(m.sql);
        } catch (e: unknown) {
          // Idempotent: some migrations may already be present if the database
          // was created with the full schema rather than walking the chain.
          // "duplicate column name" means ADD COLUMN had no effect — safe to
          // bump the version and continue. All other errors are real failures.
          if (
            e instanceof Error &&
            e.message.includes("duplicate column name")
          ) {
          } else {
            throw e;
          }
        }
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
/**
 * Joined view of a `messages` row with its author's name from `participants`.
 *
 * Every message query returns this shape so routes share one projection and
 * don't silently diverge when columns are added.
 *
 * @property rowid - Monotonic SQLite rowid; the canonical pagination cursor.
 * @property attachments - JSON-encoded `MessageAttachment[]`; `null`/`""` means none.
 * @property reply_to_id - ULID of the replied-to message, or `null`.
 * @property deleted - `1` if recalled (soft-deleted), otherwise `0`.
 * @property channel - Canonical channel slug; `"general"` for backfilled pre-multi-channel rows.
 * @property edited_at - Epoch-ms of the most recent edit, or `null` when never edited.
 * @property edited_count - Number of successful edits (0 when never edited).
 */
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
  channel: ChannelSlugType; // canonical channel slug; "general" for backfilled rows
  edited_at: number | null; // epoch-ms of most recent edit, or null
  edited_count: number; // successful edit count; 0 when never edited
}

// Shared SELECT fragment + JOIN for every messages↔participants projection.
// A single constant so adding a column (e.g. a future status field) requires
// one edit rather than hunting six prepared statements for stale aliases.
// Consumers compose it with their own WHERE / ORDER BY / LIMIT clauses.
const messageProjectionSql =
  'SELECT m.id, m.content, m.created_at, m.rowid, m.attachments, m.reply_to_id, m.deleted, m.channel, m.edited_at, m.edited_count, ' +
  '       p.id AS participant_id, p.name AS author_name FROM messages m JOIN participants p ON p.id = m.participant_id';

const insertMessageStmt = db.prepare(
  `INSERT INTO messages (id, participant_id, content, created_at, attachments, reply_to_id, channel)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

/**
 * Insert a new message row. Used by the message-create handler after auth +
 * mention extraction; caller is responsible for providing a valid `id` and
 * the participant that authored the message.
 *
 * @param id - ULID message id (caller-generated).
 * @param participantId - ID of the author participant.
 * @param content - Normalised message body (may be empty for attachment-only messages).
 * @param createdAt - Message timestamp in epoch ms.
 * @param attachments - Optional JSON array of attachment ids, or `null`.
 * @param replyToId - Optional id of the replied-to message, or `null`.
 * @param channel - Channel slug the message belongs to.
 */
export function insertMessage(
  id: string,
  participantId: string,
  content: string,
  createdAt: number,
  attachments: string | null,
  replyToId: string | null,
  channel: ChannelSlugType
): void {
  insertMessageStmt.run(id, participantId, content, createdAt, attachments, replyToId, channel);
}

const allParticipantsSelectStmt = db.prepare<[], { id: string; name: string; bio: string; created_at: number }>(
  `SELECT id, name, bio, created_at FROM participants WHERE deleted = 0 ORDER BY created_at ASC`
);

// Cache the prepared-statement result (the full participants table) so frequent
// roster polls skip the DB.
const participantsRowsCache = new Map<
  symbol,
  ReturnType<typeof allParticipantsSelectStmt.all>
>();
const PARTICIPANTS_CACHE_KEY = Symbol('participantsCache');

/** All participants, newest first. Used by the channel-member list endpoint.
 *
 * Performance: serves from a small LRU in JS so frequent roster polls
 * (presence-aware UI clients) skip the DB. The cache is invalidated via
 * {@link invalidateParticipantNamesCache}, which is already called on every
 * participant mutation (create / delete / recover) in the participant route.
 */
export function getAllParticipants(): { id: string; name: string; bio: string; created_at: number }[] {
  const hit = participantsRowsCache.get(PARTICIPANTS_CACHE_KEY);
  if (hit !== undefined) return hit;
  const rows = allParticipantsSelectStmt.all();
  participantsRowsCache.set(PARTICIPANTS_CACHE_KEY, rows);
  return rows;
}

/** Explicitly drop the entire participants list cache. Useful in tests. */
export function clearParticipantsCache(): void {
  participantsRowsCache.delete(PARTICIPANTS_CACHE_KEY);
}

const afterStmt = db.prepare<[number, string, number], MessageRow>(
  `${messageProjectionSql} WHERE m.rowid > ? AND m.channel = ? ORDER BY m.rowid ASC LIMIT ?`
);

const recentStmt = db.prepare<[string, number], MessageRow>(
  `${messageProjectionSql} WHERE m.channel = ? ORDER BY m.rowid DESC LIMIT ?`
);

const sinceStmt = db.prepare<[string], { rowid: number }>(
  `SELECT rowid FROM messages WHERE id = ?`
);

const sinceMessagesStmt = db.prepare<[number, string, number], MessageRow>(
  `${messageProjectionSql} WHERE m.rowid > ? AND m.channel = ? ORDER BY m.rowid ASC LIMIT ?`
);

/** Messages with `rowid > rowid` in the given channel, newest first. Backs the
 * "load more recent" SSE / polling path on the history tail. */
export function getMessagesAfter(rowid: number, channel: ChannelSlugType, limit: number): MessageRow[] {
  return afterStmt.all(rowid, channel, limit);
}

/** Most recent messages in the given channel, **oldest first** within the page. Backs the initial
 * history fetch when a client opens a channel for the first time.
 *
 * Note the ordering: the DB query returns rows newest-first (DESC on rowid),
 * but the result is reversed so consumers (and the list/search routes) receive
 * messages in chronological order. The contract is "get the N most recent rows,
 * ordered oldest→newest" — callers like GET /messages expect the oldest row
 * first so pagination with `since` works against the tail of the page.
 */
export function getRecentMessages(channel: ChannelSlugType, limit: number): MessageRow[] {
  return recentStmt.all(channel, limit).reverse();
}

/** Messages published after the one with id `sinceId`, scoped to `channel`,
 * oldest→newest. Returns `{ rowid, messages }` so the caller can advance the
 * cursor. Returns `{ rowid: 0, messages: [] }` when `sinceId` is unknown.
 *
 * Performance: `sinceId` is resolved to a rowid via a cached prepared
 * statement before the paginated SELECT runs, so the cursor is monotonic
 * even if clocks skew.
 *
 * @param sinceId - ULID message id to fetch messages after.
 * @param channel - Channel slug.
 * @param limit - Page size.
 * @returns Current cursor rowid and the next page of messages.
 */
export function getMessagesSince(
  sinceId: string,
  channel: ChannelSlugType,
  limit: number
): { rowid: number; messages: MessageRow[] } {
  const row = sinceStmt.get(sinceId);
  if (!row) return { rowid: 0, messages: [] as MessageRow[] };
  return { rowid: row.rowid, messages: sinceMessagesStmt.all(row.rowid, channel, limit) };
}

const beforeStmt = db.prepare<[number, string, number], MessageRow>(
  `${messageProjectionSql} WHERE m.rowid < ? AND m.channel = ? ORDER BY m.rowid DESC LIMIT ?`
);

/** Messages older than `beforeId`, chronologic (oldest→newest within the page).
 *  Backs the "scroll up to load earlier history" UI — the mirror of
 *  getMessagesSince: take the N rows with rowid < beforeId's (DESC to grab the
 *  nearest older ones), then reverse to ascending. Returns [] if beforeId is
 *  unknown (e.g. it was just deleted). Scoped to `channel`. */
export function getMessagesBeforeId(beforeId: string, channel: ChannelSlugType, limit: number): MessageRow[] {
  const row = sinceStmt.get(beforeId);
  if (!row) return [];
  return beforeStmt.all(row.rowid, channel, limit).reverse();
}

/** Context window around `aroundId`: a few messages BEFORE it, the anchor
 *  itself, then a few AFTER - oldest->newest. Backs `club read --around <id>`
 *  so a reader (human or agent) landing on a message id sees the surrounding
 *  conversation, not just the forward tail `--since` would give.
 *
 *  Splits `limit` as `floor(limit/2)` before + the anchor + the rest after, so
 *  the page biases slightly toward earlier context (the gap `--since` leaves).
 *  Returns [] when the anchor is unknown or lives in another channel - same
 *  "unknown id -> empty" contract as getMessagesBeforeId / getMessagesSince.
 *
 *  Reuses the before/since prepared statements + getMessageById (which already
 *  joins the author projection); no new SQL. */
export function getMessagesAround(aroundId: string, channel: ChannelSlugType, limit: number): MessageRow[] {
  const anchor = getMessageById(aroundId);
  if (!anchor) return [];
  if (anchor.channel !== channel) return [];
  const half = Math.floor(limit / 2);
  const before = half > 0 ? beforeStmt.all(anchor.rowid, channel, half).reverse() : [];
  const after = limit - 1 - half > 0 ? sinceMessagesStmt.all(anchor.rowid, channel, limit - 1 - half) : [];
  return [...before, anchor, ...after];
}

const searchAllStmt = db.prepare<[string, number], MessageRow>(
  `${messageProjectionSql} WHERE m.content LIKE ? ESCAPE '\\\\' ORDER BY m.rowid DESC LIMIT ?`
);

const searchChannelStmt = db.prepare<[string, string, number], MessageRow>(
  `${messageProjectionSql} WHERE m.content LIKE ? ESCAPE '\\\\' AND m.channel = ? ORDER BY m.rowid DESC LIMIT ?`
);

/** Messages whose content contains `q` (substring via LIKE), newest first.
 *  Backs the search box. When `channel` is null/empty the search spans all channels;
 *  otherwise it is scoped to that channel.
 *
 *  The user-supplied `q` is escaped so `%` / `_` / `\\` are treated as
 *  literal characters (no LIKE wildcard injection).
 */
export function searchMessages(q: string, channel: ChannelSlugType | null, limit: number): MessageRow[] {
  const escaped = `%${escapeLike(q)}%`;
  return channel ? searchChannelStmt.all(escaped, channel, limit) : searchAllStmt.all(escaped, limit);
}

/** The channel a message lives in. Used to channel-scope `message_deleted` / `message_reaction`
 * SSE fan-out — the delete/reaction routes know only the id, and a message's
 * channel never changes. Returns `undefined` when the id is unknown.
 *
 * @param id - ULID message id.
 */
const messageChannelStmt = db.prepare<[string], { channel: string }>(
  `SELECT channel FROM messages WHERE id = ?`
);
export function getMessageChannel(id: string): string | undefined {
  return messageChannelStmt.get(id)?.channel;
}

// Reuses messageProjectionSql so the persisted-read-back contract stays in
// sync with list/search — a future column added to the shared projection is
// automatically present here too, rather than needing a separate edit that
// could be missed.
const messageByIdStmt = db.prepare<[string], MessageRow>(
  `${messageProjectionSql} WHERE m.id = ?`
);
/**
 * Read back a single message row by id.
 *
 * Intended for the POST /messages hot path, which inserts the row and then
 * hands the persisted copy to `toMessage()` rather than reconstructing the
 * API shape inline. The read-back is cheap (primary-key lookup) and keeps the
 * response contract synchronized with list/search.
 *
 * @returns The message row, or `undefined` if the id was never persisted.
 */
export function getMessageById(id: string): MessageRow | undefined {
  return messageByIdStmt.get(id);
}

const deleteStmt = db.prepare<[string, string]>(
  `UPDATE messages SET deleted = 1 WHERE id = ? AND participant_id = ? AND deleted = 0`
);

/** Soft-delete (recall) a message. Only the author may (participant_id check).
 *  Returns `{ ok: boolean, channel: string | undefined }`. The channel is returned
 *  so the caller can scope the SSE `message_deleted` broadcast without a
 *  second `SELECT channel FROM messages` round-trip.
 *
 *  @returns ok is false when the row was not found, not owned by the caller,
 *    or already recalled; channel is always populated on success.
 */
export function deleteMessage(id: string, participantId: string): { ok: boolean; channel: string | undefined } {
  const channel = getMessageChannel(id);
  const ok = deleteStmt.run(id, participantId).changes > 0;
  return { ok, channel };
}

const updateMessageStmt = db.prepare<[string, number, string, string]>(
  `UPDATE messages SET content = ?, edited_at = ?, edited_count = edited_count + 1
   WHERE id = ? AND participant_id = ? AND deleted = 0`
);

/**
 * Update a message's content, recording the edit.
 *
 * Only the author may edit (`participant_id` check). Returns `{ ok: boolean,
 * channel: string | undefined }` so the caller can scope the SSE fan-out.
 *
 * @returns `ok` is false when the row was not found, not owned by the caller,
 *   or already recalled; `channel` is always populated on success.
 */
export function updateMessage(
  id: string,
  participantId: string,
  content: string,
): { ok: boolean; channel: string | undefined } {
  const channel = getMessageChannel(id);
  const ok = updateMessageStmt.run(content, Date.now(), id, participantId).changes > 0;
  return { ok, channel };
}

const removeReactionStmt = db.prepare<[string, string, string]>(
  `DELETE FROM reactions WHERE message_id = ? AND participant_id = ? AND emoji = ?`
);
const addReactionStmt = db.prepare<[string, string, string]>(
  `INSERT OR IGNORE INTO reactions (message_id, participant_id, emoji) VALUES (?, ?, ?)`
);
const reactionsForMsgStmt = db.prepare<[string], { emoji: string; participant_id: string }>(
  `SELECT emoji, participant_id FROM reactions WHERE message_id = ?`
);

/** Aggregate reactions on a message (emoji → count). */
export function getReactionsForMessage(messageId: string): Reaction[] {
  const rows = reactionsForMsgStmt.all(messageId);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
  return [...counts.entries()].map(([emoji, count]): Reaction => ({ emoji, count }));
}

/**
 * Batch-fetch reactions for multiple messages, chunked to avoid exceeding
 * SQLite's 32,767 parameter limit and to bound individual statement size.
 * Returns a Map<message_id, Reaction[]> keyed by the ids that had reactions.
 *
 * Performance: each chunk uses a fixed-arity prepared statement cached by
 * chunk size. Reactions are queried frequently during history renders, so
 * fixed-arity statements are prepared once and reused. Chunking guarantees
 * O(messages / chunk) index seeks instead of one unbounded scan, and prevents
 * SQL length blow-up when a channel's history page contains hundreds of messages.
 */
const REACTIONS_BATCH_SIZE = 50;
const reactionsBatchCache = new Map<
  number,
  ReturnType<typeof db.prepare<[...string[]], { message_id: string; emoji: string; count: number }>>
>();
function reactionsBatchStmt(n: number) {
  let stmt = reactionsBatchCache.get(n);
  if (!stmt) {
    const placeholders = '?,'.repeat(n).slice(0, -1);
    const sql =
      `SELECT message_id, emoji, COUNT(*) AS count FROM reactions` +
      ` WHERE message_id IN (${placeholders})` +
      ` GROUP BY message_id, emoji`;
    stmt = db.prepare<[...string[]], { message_id: string; emoji: string; count: number }>(sql);
    reactionsBatchCache.set(n, stmt);
  }
  return stmt;
}

export function getReactionsForMessages(messageIds: string[]): Map<string, Reaction[]> {
  const out = new Map<string, Reaction[]>();
  for (let i = 0; i < messageIds.length; i += REACTIONS_BATCH_SIZE) {
    const batch = messageIds.slice(i, i + REACTIONS_BATCH_SIZE);
    const stmt = reactionsBatchStmt(batch.length);
    const rows = stmt.all(...(batch as [...string[]]));
    for (const r of rows) {
      let entry = out.get(r.message_id);
      if (!entry) {
        entry = [];
        out.set(r.message_id, entry);
      }
      entry.push({ emoji: r.emoji, count: r.count } satisfies Reaction);
    }
  }
  return out;
}

/** Toggle a reaction (remove if present, add if absent). Returns the refreshed
 *  aggregate along with the message's channel, so the caller can scope the SSE
 *  `message_reaction` broadcast without a second `SELECT channel FROM messages`
 *  round-trip on the hot path.
 *
 *  @returns `{ reactions, channel }` — channel is always populated for a known id.
 */
export function toggleReaction(
  messageId: string,
  participantId: string,
  emoji: string
): { reactions: Reaction[]; channel: string | undefined } {
  const channel = getMessageChannel(messageId);
  const removed = removeReactionStmt.run(messageId, participantId, emoji).changes > 0;
  if (!removed) addReactionStmt.run(messageId, participantId, emoji);
  return { reactions: getReactionsForMessage(messageId), channel };
}

export interface ParticipantRow {
  id: string;
  name: string;
  bio: string;
  created_at: number;
  /** Soft-delete flag (v18): 0 = active, 1 = deactivated (hidden, can't auth). */
  deleted: number;
}

const participantByKeyHashStmt = db.prepare<[string], ParticipantRow | undefined>(
  `SELECT id, name, bio, created_at, deleted FROM participants WHERE key_hash = ? AND deleted = 0`
);

/** Participant row looked up by hashed key (auth path). Returns undefined if
 *  no participant matches the key. */
export function getParticipantByKeyHash(hash: string): ParticipantRow | undefined {
  return participantByKeyHashStmt.get(hash);
}

const participantByNameStmt = db.prepare<[string], ParticipantRow | undefined>(
  `SELECT id, name, bio, created_at, deleted FROM participants WHERE name = ?`
);

/** Participant row looked up by callsign. Returns undefined if the name
 *  doesn't exist. */
export function getParticipantByName(name: string): ParticipantRow | undefined {
  return participantByNameStmt.get(name);
}

const insertParticipantStmt = db.prepare(
  `INSERT INTO participants (id, name, bio, key_hash, recover_hash, created_at)
   VALUES (?, ?, ?, ?, ?, ?)`
);

/** Insert a new participant (idempotent at the row level — only called from
 * the create-participant handler after auth). Caller passes already-hashed
 * key and recover values; see `crypto.ts` and the recover flow.
 *
 * @param id - ULID participant id (caller-generated).
 * @param name - Callsign.
 * @param keyHash - SHA-256 hex digest of the API key.
 * @param recoverHash - SHA-256 hex digest of the one-time recovery code, or `''`.
 * @param createdAt - Epoch ms.
 */
export function insertParticipant(
  id: string,
  name: string,
  bio: string,
  keyHash: string,
  recoverHash: string,
  createdAt: number
): void {
  insertParticipantStmt.run(id, name, bio, keyHash, recoverHash, createdAt);
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
  bio: string;
  created_at: number;
  recover_hash: string | null;
}

const getParticipantForRecoverStmt = db.prepare<[string], ParticipantRecoverRow>(
  `SELECT id, name, bio, created_at, recover_hash FROM participants WHERE name = ?`
);

/** A participant row including recover_hash, looked up by callsign (for the
 *  recovery endpoint). Returns undefined if the name doesn't exist. */
export function getParticipantForRecover(name: string): ParticipantRecoverRow | undefined {
  return getParticipantForRecoverStmt.get(name);
}

const updateParticipantKeyStmt = db.prepare(`UPDATE participants SET key_hash = ? WHERE id = ?`);

/** Rotate the participant's key (recovery flow). Idempotent at the row level. */
export function updateParticipantKey(id: string, newKeyHash: string): void {
  updateParticipantKeyStmt.run(newKeyHash, id);
}

const updateParticipantRecoverStmt = db.prepare(
  `UPDATE participants SET recover_hash = ? WHERE id = ?`
);

/** Set the participant's recover_hash. Pass null to clear (invalidate) it,
 *  or a sha256 hex string to arm a new recovery code. */
export function updateParticipantRecover(id: string, newHash: string | null): void {
  updateParticipantRecoverStmt.run(newHash, id);
}

const updateParticipantBioStmt = db.prepare(
  `UPDATE participants SET bio = ? WHERE id = ?`
);

/** Set the participant's bio (free-form self-introduction / role description).
 *  Pass "" to clear. Idempotent at the row level. The caller is responsible for
 *  calling {@link invalidateParticipantNamesCache} afterwards so the members
 *  list cache (which carries bio) is dropped - mirroring insertParticipant /
 *  updateParticipantKey, which also leave invalidation to their callers.
 *
 *  @param id - Participant id.
 *  @param bio - Already-sanitized single-line bio (the route parses through the
 *    shared ParticipantBio schema, which strips control chars and caps length).
 */
export function updateParticipantBio(id: string, bio: string): void {
  updateParticipantBioStmt.run(bio, id);
}

// ── Account deactivation (soft delete) ───────────────────────────────

/**
 * Soft-delete a participant: blank the credentials (so the account can no
 * longer authenticate or be recovered) and set the `deleted` flag (so the
 * account drops out of the roster and the @mention name set). The row is kept,
 * so messages still JOIN to a valid author name - the participant's authored
 * content (messages, reactions, mentions) is preserved untouched and history
 * stays intact. Shared by the self-delete (DELETE /:id, two-factor) and kick
 * (POST /:id/kick, open) paths; they differ only in authorization.
 */
const softDeleteParticipantStmt = db.prepare(
  `UPDATE participants SET key_hash = '', recover_hash = NULL, deleted = 1 WHERE id = ?`
);
export function softDeleteParticipant(id: string): void {
  softDeleteParticipantStmt.run(id);
}

// ── Mentions (per-participant @-mention inbox) ──────────────────────

/**
 * DB row for a mention inbox entry. Populated when a message containing an
 * `@<name>` mention is inserted; the server writes one row per unique
 * (`message_id`, `participant_id`) pair so each @-mention is delivered once.
 *
 * @property id - ULID of this mention row (the inbox cursor).
 * @property message_id - ULID of the source message.
 * @property participant_id - ID of the participant who was @-mentioned (inbox owner).
 * @property author_id - ID of the message author.
 * @property content - The message body (stored so the inbox can render context
 *   even after the message is recalled).
 * @property read_at - Epoch-ms when the owner marked this read; `null` = unread.
 * @property channel - Channel slug of the source message (deep-link source).
 */
export interface MentionRow {
  id: string;
  message_id: string;
  participant_id: string;
  author_id: string;
  author_name: string;
  content: string;
  message_created_at: number;
  read_at: number | null;
  channel: string; // channel the mentioning message was posted in (deep-link source)
}

const allParticipantsStmt = db.prepare<[], { id: string; name: string }>(
  `SELECT id, name FROM participants WHERE deleted = 0`
);

/**
 * In-memory cache of the participant roster. The roster changes only when a
 * participant is created or recovered — operations that are rare compared to
 * message sends. Keeping a cached copy avoids a full table scan + fresh array
 * allocation on every `POST /messages`, which calls this to compute the
 * recipient set for @-mentions. Writes are invalidated synchronously at the
 * mutation sites (insertParticipant / updateParticipantKey /
 * updateParticipantRecover) so there is no window of observable staleness.
 *
 * @internal
 */
const participantNamesCache = new Map<string, { id: string; name: string }>();
// Mutable holder so we can swap the frozen snapshot reference without a `let`.
// `extractMentionedParticipants()` compares its caller's roster by reference to
// decide whether to rebuild its name→participant Map; returning the SAME array
// reference between mutations keeps that comparison happy on every message send
// (O(0) — no Map rebuild, no allocation). A fresh `[...map.values()]` on each
// call would blow the identity check and pay the rebuild cost per message.
const participantNamesRef = {
  current: Object.freeze([] as readonly { id: string; name: string }[]),
};

function _buildSnapshot(): readonly { id: string; name: string }[] {
  if (participantNamesCache.size === 0) {
    const rows = allParticipantsStmt.all();
    for (const r of rows) participantNamesCache.set(r.id, r);
  }
  return Object.freeze([...participantNamesCache.values()]) as readonly {
    id: string;
    name: string;
  }[];
}

/**
 * Lightweight roster for mention parsing: every (id, name).
 *
 * Performance: served from a frozen in-memory snapshot on the hot path
 * (message sends). The returned array reference is stable between
 * mutations, so the caller can compare it by identity to decide whether
 * its own caches need rebuilding. Call
 * {@link invalidateParticipantNamesCache} after any participant mutation.
 */
export function getAllParticipantNames(): readonly { id: string; name: string }[] {
  return participantNamesRef.current;
}

/**
 * Invalidate the participant roster cache and snapshot after a create or
 * credential rotation. Next `getAllParticipantNames()` will re-read from the
 * database and emit a fresh frozen array reference.
 *
 * Must be called synchronously after every participant mutation (insert, key
 * update, recover-code rotation) so the message-send hot path never sees stale
 * data within the same event loop tick.
 */
export function invalidateParticipantNamesCache(): void {
  participantNamesCache.clear();
  participantsRowsCache.delete(PARTICIPANTS_CACHE_KEY);
  // Build a fresh frozen snapshot so the next call returns a new array ref,
  // triggering the caller's identity-based cache rebuild.
  participantNamesRef.current = _buildSnapshot();
}

const insertMentionStmt = db.prepare(
  `INSERT OR IGNORE INTO mentions
     (id, message_id, participant_id, author_id, channel, read_at, created_at)
   VALUES (?, ?, ?, ?, ?, NULL, ?)`
);

/**
 * Insert one inbox row. `INSERT OR IGNORE` so a duplicate (same message +
 * recipient) is silently dropped rather than throwing — matches the UNIQUE
 * constraint intent. Returns whether a row was actually inserted. `channel` is the
 * channel the mentioning message was posted in, so the recipient can deep-link.
 */
export function insertMention(
  id: string,
  messageId: string,
  participantId: string,
  authorId: string,
  channel: string,
  createdAt: number
): boolean {
  return insertMentionStmt.run(id, messageId, participantId, authorId, channel, createdAt).changes > 0;
}

/** Batch-insert mention inbox rows inside a single transaction. Replaces the
 *  per-row loop in POST /messages so a message mentioning N participants no
 *  longer issues N prepared-statement round-trips.
 *
 *  @param rows - One entry per (mentioned participant, author) pair for a single message.
 *  @returns Number of rows actually inserted (duplicates silently ignored by
 *    UNIQUE(message_id, participant_id)).
 */
/**
 * Row shape for the batch-mention insert used when a new message is written.
 * Caller-assembles these from the mention parser's output and passes them to
 * {@link insertMentions}; the fields map directly onto the `mentions` table
 * columns (without the DB `rowid`), so the prepared statement's positional
 * bind order matches the column order.
 *
 * @property id - ULID of this mention row.
 * @property messageId - ULID of the source message.
 * @property participantId - ID of the participant being @-mentioned.
 * @property authorId - ID of the message author.
 * @property channel - Channel slug of the source message.
 * @property createdAt - Epoch-ms timestamp of the source message.
 */
export interface MentionInsert {
  id: string;
  messageId: string;
  participantId: string;
  authorId: string;
  channel: string;
  createdAt: number;
}

const insertMentionBatchTx = db.transaction((rows: MentionInsert[]) => {
  let inserted = 0;
  for (const r of rows) {
    inserted += insertMentionStmt.run(
      r.id, r.messageId, r.participantId, r.authorId, r.channel, r.createdAt,
    ).changes;
  }
  return inserted;
});

export function insertMentions(rows: MentionInsert[]): number {
  if (rows.length === 0) return 0;
  return insertMentionBatchTx(rows);
}

const unreadMentionsStmt = db.prepare<[string, number], MentionRow>(
  `SELECT mn.id, mn.message_id, mn.participant_id, mn.author_id,
           p.name AS author_name,
           m.content AS content, m.created_at AS message_created_at,
           mn.read_at, mn.channel
    FROM mentions mn
    JOIN messages m ON m.id = mn.message_id
    JOIN participants p ON p.id = mn.author_id
    WHERE mn.participant_id = ? AND mn.read_at IS NULL
    ORDER BY m.created_at ASC LIMIT ?`
);

/** Unread mentions for `participantId`, oldest first, capped at `limit`. */
export function getUnreadMentions(participantId: string, limit = 100): MentionRow[] {
  return unreadMentionsStmt.all(participantId, limit);
}

const mentionByIdStmt = db.prepare<
  [string],
  { id: string; participant_id: string; read_at: number | null }
>(`SELECT id, participant_id, read_at FROM mentions WHERE id = ?`);

/**
 * Lightweight mention ownership lookup by id (for PATCH /me/mentions/:id/read).
 * Only the fields the caller needs are selected, so the ownership check is a
 * single-column comparison. Returns `undefined` when the id is unknown.
 *
 * The full mention (including message content and author) is resolved by
 * {@link getMentionFull}; this row is intentionally lean because it's the hot
 * path in the bulk-read endpoint.
 */
export interface MentionByIdRow {
  id: string;
  participant_id: string;
  read_at: number | null;
}

/** A single mention's ownership + read-state, or undefined. */
export function getMentionById(id: string): MentionByIdRow | undefined {
  return mentionByIdStmt.get(id);
}

const mentionFullStmt = db.prepare<[string], MentionRow>(
  `SELECT mn.id, mn.message_id, mn.participant_id, mn.author_id,
          p.name AS author_name,
          m.content AS content, m.created_at AS message_created_at,
          mn.read_at, mn.channel
   FROM mentions mn
   JOIN messages m ON m.id = mn.message_id
   JOIN participants p ON p.id = mn.author_id
   WHERE mn.id = ?`
);

/** A single mention, fully joined (author + message content) for display. */
export function getMentionFull(id: string): MentionRow | undefined {
  return mentionFullStmt.get(id);
}

const markReadStmt = db.prepare(`UPDATE mentions SET read_at = ? WHERE id = ? AND read_at IS NULL`);

/**
 * Mark one mention read. Returns whether a row was actually updated (false if
 * it didn't exist or was already read). `readAt` is taken as a parameter so
 * callers/tests can pin the timestamp.
 */
export function markMentionRead(id: string, readAt: number): boolean {
  return markReadStmt.run(readAt, id).changes > 0;
}

/** Mark multiple mentions read in one statement, scoped to `ownerId`. Uses a
 *  cached prepared statement keyed on the placeholder count to avoid repeated
 *  statement creation on the hot path. Returns the subset of ids that were
 *  actually updated (empty if already-read or unknown). */
const markReadBatchCache = new Map<
  number,
  ReturnType<typeof db.prepare<[number, string, ...string[]], { id: string }>>
>();

/** Mark a batch of mentions read in one SQL statement, scoped to `ownerId`
 * so the caller cannot mark another participant's mentions as read.
 *
 * Uses `UPDATE ... RETURNING id` so the result contains exactly the rows this
 * statement mutated. Rows that were already read (filtered out by
 * `read_at IS NULL`) never appear, which is robust even when an earlier
 * single-read stamped the same millisecond timestamp — the previous
 * readAt-based verify SELECT could not distinguish that case.
 *
 * @param ids - Mention ids to mark read.
 * @param ownerId - Participant id that must own the mentions.
 * @param readAt - Timestamp (epoch ms) to set as read time.
 * @returns Subset of `ids` that were actually updated.
 */
export function markMentionsRead(ids: string[], ownerId: string, readAt: number): string[] {
  if (ids.length === 0) return [];
  let stmt = markReadBatchCache.get(ids.length);
  if (!stmt) {
    const placeholders = '?,'.repeat(ids.length).slice(0, -1);
    const sql = `UPDATE mentions SET read_at = ? WHERE participant_id = ? AND read_at IS NULL AND id IN (${placeholders}) RETURNING id`;
    stmt = db.prepare<[number, string, ...string[]], { id: string }>(sql);
    markReadBatchCache.set(ids.length, stmt);
  }
  return stmt.all(readAt, ownerId, ...ids).map((r) => r.id);
}

// ── Uploaded files (image metadata) ──────────────────────────────────

/**
 * DB row for an uploaded image / video / document. `id` doubles as the public
 * `/files/{id}` path; `participant_id` is the uploader, checked at
 * `POST /messages` time so a sender can only attach files it uploaded (not
 * another participant's). Metadata (`width`, `height`, `size`, `filename`) is
 * filled by the upload handler (server-side probe); clients can't supply them.
 *
 * @property id - ULID file id (public, non-guessable).
 * @property participant_id - ID of the uploading participant.
 * @property mime - MIME type detected server-side.
 * @property width - Image width in px, or `null` for non-images.
 * @property height - Image height in px, or `null` for non-images.
 * @property size - File size in bytes.
 * @property filename - Original filename if supplied, or `null`.
 */
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
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);

/** Persist a file metadata row after a successful upload.
 *
 * @param f - The file row (id is the public `/files/{id}` token).
 */
export function insertFile(f: FileRow): void {
  insertFileStmt.run(
    f.id,
    f.participant_id,
    f.mime,
    f.width,
    f.height,
    f.size,
    f.created_at,
    f.filename
  );
}

const fileByIdStmt = db.prepare<[string], FileRow>(
  `SELECT id, participant_id, mime, width, height, size, created_at, filename
   FROM files WHERE id = ?`
);

/** Retrieve a file metadata row by its public id. Returns `undefined` when
 * the id is unknown.
 *
 * @param id - Public file id used by the client.
 */
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

/** Fetch several files by id, preserving the requested order. Used by
 * `POST /messages` to rehydrate attachments from the client's `attachmentIds`
 * — order matters so the message shows images in the order the user picked
 * them. Rejected ids are dropped silently.
 *
 * Performance: the SELECT statement is cached per placeholder count rather
 * than recreated per call. Caps out at 100 ids as a defensive guard against
 * pathological abuse.
 *
 * @param ids - File ids to fetch (returned in the same order).
 * @returns File rows matching the given ids, in the same order.
 * @throws When `ids.length > 100`.
 */
export function getFilesByIds(ids: string[]): FileRow[] {
  if (ids.length === 0) return [];
  if (ids.length > 100) {
    // Defensive: a message shouldn't reference this many files. This protects
    // against pathological abuse while staying far above legitimate limits.
    throw new Error('too many file ids requested (max 100)');
  }
  const placeholders = '?,'.repeat(ids.length).slice(0, -1);
  let stmt = fileGetByIdsCache.get(ids.length);
  if (!stmt) {
    const sql = `SELECT id, participant_id, mime, width, height, size, created_at, filename
       FROM files WHERE id IN (${placeholders})`;
    stmt = db.prepare<[...string[]], FileRow>(sql);
    fileGetByIdsCache.set(ids.length, stmt);
  }
  const byId = new Map<string, FileRow>();
  const rows = stmt.all(...(ids as [...string[]]));
  for (const row of rows) {
    byId.set(row.id, row);
  }
  // One-pass ordered build: skip the intermediate [FileRow|undefined][]
  // allocation of ids.map().filter() and grow a pre-sized output array.
  const result: FileRow[] = new Array(ids.length);
  let outLen = 0;
  for (let i = 0; i < ids.length; i++) {
    const hit = byId.get(ids[i]);
    if (hit !== undefined) {
      result[outLen++] = hit;
    }
  }
  result.length = outLen;
  return result;
}

// ── Channels (multi-channel) ───────────────────────────────────────────────
//
// Channels are open topic channels (PRD §4.1). The `channels` table is the canonical
// slug registry; messages/mentions carry the slug directly (no FK by design —
// a channel's slug is immutable and stable, and messages may reference a channel
// before its registry row is observably present in a race, though in practice
// POST /messages ensures the channel exists first). `general` is the seeded system
// row and is always present.

/**
 * DB row for a chat channel. `general` is the seeded system row and is always
 * present. New channels are created by `POST /channels` or
 * {@link ensureChannel} (called by `POST /messages` if the target channel doesn't
 * exist yet).
 *
 * @property id - ULID channel id.
 * @property slug - Public key (URL-safe, lower-case, `^[a-z0-9][a-z0-9-]{0,29}$`).
 * @property created_at - Epoch-ms creation timestamp.
 * @property last_activity_at - Epoch-ms of the most recent message in this channel;
 *   `null` for empty channels. Drives "active-first" channel ordering.
 * @property display_name - Mutable human label (`null` ⇒ render the slug). The slug
 *   is the immutable key; renaming happens here.
 */
export interface ChannelRow {
  id: string;
  slug: string;
  created_at: number;
  // created_at of the most recent message in this channel; NULL for an empty channel.
  last_activity_at: number | null;
  // mutable human label; NULL ⇒ clients render the slug
  display_name: string | null;
}

// All channels with their last-activity timestamp in one scan. `general` sorts
// first, then most-recently-active first, then empty channels (NULL activity) last
// by created_at. The LEFT JOIN + MAX yields NULL activity for channels with no
// messages — exactly what clients need for "active-first" ordering without a
// second round-trip.
const listChannelsStmt = db.prepare<[], ChannelRow>(
  `SELECT r.id, r.slug, r.created_at, r.display_name,
          MAX(m.created_at) AS last_activity_at
   FROM channels r
   LEFT JOIN messages m ON m.channel = r.slug
   GROUP BY r.id, r.slug, r.created_at, r.display_name
   ORDER BY (r.slug = 'general') DESC, last_activity_at DESC, r.created_at ASC`
);

// LRU cache keyed by a module symbol for the full channels list. GET /channels is
// a read-heavy endpoint (channel list UI tabs, sidebar refresh, presence sync)
// yet the underlying data is a full-table scan + LEFT JOIN + MAX aggregation.
// Channels are created far less often than they are listed, so an in-memory
// snapshot skips the DB on the common path. The cache is invalidated via
// invalidateChannelsCache (called by POST /channels on creation) and shared with
// clearChannelCache for operational consistency (seed/migration scripts call the
// same hook for both the single-slug LRU and this list cache).
const listChannelsCache = new Map<
  symbol,
  ReturnType<typeof listChannelsStmt.all>
>();
const CHANNELS_CACHE_KEY = Symbol('channelsCache');

/** Invalidate the channels list cache. Called on every channel create/drop so the
 * next list request re-reads the authoritative data from the DB. Shared with
 * clearChannelCache so seed/migration scripts and explicit drops need a single
 * hook. */
export function invalidateChannelsCache(): void {
  listChannelsCache.delete(CHANNELS_CACHE_KEY);
  clearChannelCache();
  invalidateChannelBySlugCache();
}

/** All channels with their last-activity timestamp in one scan. `general` sorts
 * first, then most-recently-active first, then empty channels (NULL activity)
 * last by created_at. The LEFT JOIN + MAX yields NULL activity for channels with
 * no messages — exactly what clients need for "active-first" ordering without a
 * second round-trip.
 *
 * Performance: served from a small in-memory snapshot on the hot path. A
 * fresh SELECT + aggregation is only issued on the very first request and after
 * an explicit create/drop that invalidates the cache. Call
 * invalidateChannelsCache after channel mutations.
 *
 * @returns Channel rows, active-first. `general` always first when it has activity.
 */
export function listChannels(): ChannelRow[] {
  const hit = listChannelsCache.get(CHANNELS_CACHE_KEY);
  if (hit !== undefined) return hit;
  const rows = listChannelsStmt.all();
  listChannelsCache.set(CHANNELS_CACHE_KEY, rows);
  return rows;
}

const channelBySlugStmt = db.prepare<[string], { id: string; slug: string; created_at: number; display_name: string | null }>(
  `SELECT id, slug, created_at, display_name FROM channels WHERE slug = ?`
);

// One-channel variant of listChannelsStmt: fetch a single channel's metadata plus its
// last-activity timestamp in one query. Used by POST /channels after a
// already-existing slug is re-read. Replaces listChannels().find(slug), which
// scans the entire channels table with a LEFT JOIN + MAX aggregation for every
// request — linear in channel count and wasteful on the common path where the
// channel already exists. A targeted single-row query is O(1) with the
// UNIQUE(slug) constraint.
const channelBySlugWithActivityStmt = db.prepare<[string], ChannelRow | undefined>(`
  SELECT r.id, r.slug, r.created_at, r.display_name,
         MAX(m.created_at) AS last_activity_at
   FROM channels r
   LEFT JOIN messages m ON m.channel = r.slug
   WHERE r.slug = ?
   GROUP BY r.id, r.slug, r.created_at, r.display_name
`);

// LRU cache keyed by slug for getChannelBySlug — a JS map hit beats a DB
// lookup on the hot path (e.g. POST /channels re-reading an existing channel after
// ensureChannel, GET /channels/{slug}, and presence sync). Channels are created far
// less often than they are looked up, so a bounded in-memory snapshot skips
// the SQL on the common path. Shared invalidation with invalidateChannelsCache
// (called on channel create/drop) keeps both lookups consistent.
const channelBySlugCache = new Map<string, ChannelRow | undefined>();
const CHANNEL_BY_SLUG_CACHE_MAX = 512;

/** Invalidate the per-slug channel cache. Called on every channel create/drop so
 * the next getChannelBySlug re-reads the authoritative data from the DB. */
export function invalidateChannelBySlugCache(): void {
  channelBySlugCache.clear();
}

/** Look up a single channel by slug, including its last-activity timestamp.
 *  Returns undefined when the slug is not in the registry.
 *
 *  Performance: single-row targeted query using the UNIQUE(slug) constraint;
 *  avoids the full-table scan + aggregation that listChannels().find(slug) would
 *  require. Results are cached in a bounded LRU and invalidated on channel
 *  create/drop, so subsequent lookups for the same slug are O(1) in JS.
 *  Same output shape as listChannels() so toChannel() can handle both.
 *
 *  @param slug - Canonical channel slug (validated by the caller).
 *  @returns Channel row with lastActivityAt, or undefined.
 */
export function getChannelBySlug(slug: string): ChannelRow | undefined {
  if (channelBySlugCache.has(slug)) return channelBySlugCache.get(slug);
  const row = channelBySlugWithActivityStmt.get(slug);
  if (channelBySlugCache.size >= CHANNEL_BY_SLUG_CACHE_MAX) {
    const first = channelBySlugCache.keys().next().value;
    if (first !== undefined) channelBySlugCache.delete(first);
  }
  channelBySlugCache.set(slug, row);
  return row;
}

const insertChannelStmt = db.prepare(
  `INSERT OR IGNORE INTO channels (id, slug, created_at) VALUES (?, ?, ?)`
);

// LRU cache keyed by slug for ensureChannel — a JS map hit beats a DB lookup on
// the hot path (every POST /messages probes the same channel that already exists).
// Invalidate on explicit channel creation so a brand-new slug is re-read from the
// DB on first use, and on any future invalidation point (e.g. migration that
// repopulates the channels table). Max size keeps memory bounded and preserves
// eviction pressure on stale entries without allocating on every call.
const channelCache = new Map<string, { id: string; slug: string; created_at: number; display_name: string | null }>();
const CHANNEL_CACHE_MAX = 512;

/** Ensure a channel with `slug` exists, creating it if missing. Idempotent: a
 *  pre-check (cached in most cases) returns the existing row; INSERT guards the
 *  rare race of two concurrent creates. Returns the channel plus `created`
 *  (true iff this call actually inserted the row) so the route can pick 201 vs
 *  200.
 *
 *  Performance: lookups for channels that already exist are served from a small LRU
 *  in JS, avoiding a full `SELECT` on every call. The cache is bounded to
 *  CHANNEL_CACHE_MAX entries and invalidated on explicit drop; newly-inserted slugs
 *  are cached once so subsequent ensureChannel calls for the same channel are O(1).
 */
export function ensureChannel(
  slug: string,
  createdAt: number
): { id: string; slug: string; created_at: number; display_name: string | null; created: boolean } {
  const hit = channelCache.get(slug);
  if (hit !== undefined) {
    // promote (LRU) without reallocating
    channelCache.delete(slug);
    channelCache.set(slug, hit);
    return { ...hit, created: false };
  }
  const existing = channelBySlugStmt.get(slug);
  if (existing) {
    if (channelCache.size >= CHANNEL_CACHE_MAX) {
      const first = channelCache.keys().next().value;
      if (first !== undefined) channelCache.delete(first);
    }
    channelCache.set(slug, existing);
    return { ...existing, created: false };
  }
  const id = ulid();
  insertChannelStmt.run(id, slug, createdAt);
  const row = { id, slug, created_at: createdAt, display_name: null as string | null };
  channelCache.set(slug, row);
  return { ...row, created: true };
}

/** Explicitly drop the entire channel slug cache. Call after operations that
 *  repopulate the channels table (migrations, seed scripts) so subsequent
 *  ensureChannel lookups read current state from the DB. */
export function clearChannelCache(): void {
  channelCache.clear();
}

const updateChannelDisplayNameStmt = db.prepare<[string | null, string]>(
  `UPDATE channels SET display_name = ? WHERE slug = ?`
);

/** Set a channel's mutable display name (pass `null` to clear → clients render the
 *  slug). The slug itself never changes — it is the key referenced by
 *  messages/SSE/mentions. Returns whether a row was actually updated (false ⇒ the
 *  slug is unknown). The caller must invalidate the channel caches so the new
 *  name shows on the next list/get. */
export function updateChannelDisplayName(slug: string, displayName: string | null): boolean {
  return updateChannelDisplayNameStmt.run(displayName, slug).changes > 0;
}

// Cascade-delete everything owned by a channel, in FK-safe order, then the channel
// row itself. Runs in one transaction so a partial failure can't leave orphans.
// `reactions.message_id` REFERENCES messages(id) (FK on, db.ts pragma), so
// reactions must go before messages; mentions have no FK to messages but reference
// the channel slug textually, so they are scoped by `channel = ?`.
const deleteChannelTx = db.transaction((slug: string) => {
  db.prepare(
    `DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE channel = ?)`
  ).run(slug);
  db.prepare(`DELETE FROM mentions WHERE channel = ?`).run(slug);
  db.prepare(`DELETE FROM messages WHERE channel = ?`).run(slug);
  db.prepare(`DELETE FROM channels WHERE slug = ?`).run(slug);
});

/** Delete a channel and cascade-clean its messages, mentions, and reactions. The
 *  seeded `general` channel is protected and never deleted (returns false); every
 *  other channel may be removed by any participant (open-CRUD model). Returns
 *  whether the channel was deleted (false ⇒ it was `general` or unknown). The
 *  caller must invalidate the channel caches afterwards. */
export function deleteChannel(slug: string): boolean {
  if (slug === 'general') return false;
  // Existence probe before the cascade so the return value is truthful without a
  // post-delete re-read (the cascade DELETE itself reports changes, but mixing it
  // with the FK-ordered multi-statement tx would muddy the signal).
  if (channelBySlugStmt.get(slug) === undefined) return false;
  deleteChannelTx(slug);
  return true;
}
