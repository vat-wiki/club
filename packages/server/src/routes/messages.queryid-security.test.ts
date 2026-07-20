import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { Hono } from "hono";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const dbPath = join(tmpdir(), `club-msg-qid-${randomUUID()}.db`);
process.env.CLUB_DB = dbPath;

const { messages } = await import("./messages.js");
const { participants } = await import("./participants.js");

const app = new Hono();
app.route("/participants", participants);
app.route("/messages", messages);

afterAll(() => {
  for (const ext of ["", "-wal", "-shm"]) rmSync(dbPath + ext, { force: true });
});

async function mintKey(name: string): Promise<string> {
  const res = await app.request("/participants", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return (await res.json()).key;
}

describe("GET /messages query-param id validation", () => {
  let key: string;
  beforeAll(async () => {
    key = await mintKey("alice");
  });

  const badIds = [
    "has spaces",       // space — not in [A-Za-z0-9_-]
    "foo/bar",          // slash — path separator
    "\nfoo",            // newline — CRLF injection vector
    "",                 // empty string
    "foo@bar",          // @ — not in id charset
    "foo:bar",          // : — not in id charset
    "..",               // dot — not in id charset (traversal token)
    "foo..bar",         // dot — not in id charset
  ];

  for (const dir of ["since", "before"]) {
    describe(`${dir}`, () => {
      it("rejects invalid ids with 400", async () => {
        for (const bad of badIds) {
          const res = await app.request(`/messages?${dir}=${encodeURIComponent(bad)}`, {
            headers: { Authorization: `Bearer ${key}` },
          });
          expect(res.status, `${dir}=${bad}`).toBe(400);
          const body = await res.json();
          expect(body.error).toMatch(new RegExp(`${dir} id`));
        }
      });
    });
  }
});
