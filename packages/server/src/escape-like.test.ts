import { describe, it, expect, afterAll } from "vitest";
import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { escapeLike } from "@club/shared";

/** Build an isolated temp SQLite db with known messages so we can
 *  exercise the full search code path (LIKE + escapeLike) without touching
 *  the global CLUB_DB singleton (which runs schema migrations on import).
 *
 *  The queries use `ESCAPE '\\'` so backslash is the escape character,
 *  matching what `db.ts` does now.
 */
function makeDb() {
  const path = join(tmpdir(), `club-srch-${randomUUID()}.db`);
  const db = new Database(path);
  db.exec(`
    CREATE TABLE participants (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      created_at  INTEGER NOT NULL
    );
    CREATE TABLE messages (
      id             TEXT PRIMARY KEY,
      participant_id TEXT NOT NULL REFERENCES participants(id),
      content        TEXT NOT NULL,
      created_at     INTEGER NOT NULL
    );
  `);

  db.prepare(`INSERT INTO participants VALUES (?, ?, ?)`).run("p1", "alice", 1);
  const insert = db.prepare(
    `INSERT INTO messages (id, participant_id, content, created_at) VALUES (?, ?, ?, ?)`
  );
  // 7 rows with tricky characters
  const rows = [
    "hello world",
    "hello 100%",
    "hello_world",
    "hello\\world", // contains a literal backslash
    "foo bar baz",
    "100% off!",
    "%_%",
  ];
  for (let i = 0; i < rows.length; i++)
    insert.run(`m${i + 1}`, "p1", rows[i], i + 1);

  const searchStmt = db.prepare(
    `SELECT id, content, participant_id, created_at FROM messages WHERE content LIKE ? ESCAPE '\\' ORDER BY content LIMIT ?`
  );

  function search(q: string, limit = 100) {
    return searchStmt.all(`%${escapeLike(q)}%`, limit);
  }

  return { db, path, search };
}

afterAll(() => {
  // Temp files orphaned — fine for CI; OS reclaims on reboot.
});

describe("escapeLike", () => {
  it("leaves plain text unchanged", () => {
    expect(escapeLike("hello world")).toBe("hello world");
  });
  it("escapes percent", () => {
    expect(escapeLike("100%")).toBe("100\\%");
  });
  it("escapes underscore", () => {
    expect(escapeLike("hello_world")).toBe("hello\\_world");
  });
  it("doubles a literal backslash", () => {
    // Input string contains one backslash between a and b
    expect(escapeLike("a\\b")).toBe("a\\\\b");
  });
  it("escapes all three wildcards together", () => {
    expect(escapeLike("%_%")).toBe("\\%\\_\\%");
  });
  it("handles empty string", () => {
    expect(escapeLike("")).toBe("");
  });
});

describe("search: LIKE wildcard injection defense", () => {
  const { search } = makeDb();

  it("a bare % does not match every row", () => {
    const hits = search("%");
    expect(hits.length).toBe(3);
    expect(new Set(hits.map((r) => r.content))).toEqual(
      new Set(["hello 100%", "100% off!", "%_%"])
    );
  });

  it("a bare _ does not match every row", () => {
    const hits = search("_");
    expect(hits.length).toBe(2);
    expect(new Set(hits.map((r) => r.content))).toEqual(
      new Set(["hello_world", "%_%"])
    );
  });

  it("a literal backslash only matches that row", () => {
    const hits = search("\\");
    expect(hits.length).toBe(1);
    expect(hits[0].content).toBe("hello\\world");
  });

  it("the crafted combo %_% is treated as three literal chars", () => {
    const hits = search("%_%");
    expect(hits.length).toBe(1);
    expect(hits[0].content).toBe("%_%");
  });

  it("normal substring search still works", () => {
    const hits = search("hello");
    expect(hits.length).toBe(4);
    expect(new Set(hits.map((r) => r.content))).toEqual(
      new Set(["hello world", "hello 100%", "hello_world", "hello\\world"])
    );
  });

  it("no false positives for a nonexistent pattern", () => {
    expect(search("zzzzznotfound").length).toBe(0);
  });
});
