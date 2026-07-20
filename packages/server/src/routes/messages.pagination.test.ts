import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";
import { afterAll,describe, expect, it } from "vitest";

// Isolated tmp db so the chronologic assertions can use exact toEqual without
// accounting for messages other test files' participants may have inserted.
const dbPath = join(tmpdir(), `club-msg-page-${randomUUID()}.db`);
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
function auth(key: string) {
  return { Authorization: `Bearer ${key}` };
}
async function postMsg(key: string, content: string): Promise<string> {
  const res = await app.request("/messages", {
    method: "POST",
    headers: { ...auth(key), "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  return (await res.json()).id;
}

describe("GET /messages?before — backward pagination (scroll-up history)", () => {
  it("returns older messages before the id, chronologic, excluding the cursor and newer", async () => {
    const key = await mintKey("pager");
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await postMsg(key, `msg ${i}`));

    const res = await app.request(`/messages?before=${ids[3]}&limit=50`, {
      headers: auth(key),
    });
    const page = await res.json();
    expect(page.map((m: { id: string }) => m.id)).toEqual(ids.slice(0, 3));
    expect(page.map((m: { content: string }) => m.content)).toEqual([
      "msg 0",
      "msg 1",
      "msg 2",
    ]);
  });

  it("respects limit — only the N nearest older messages", async () => {
    const key = await mintKey("pager2");
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await postMsg(key, `x ${i}`));

    const res = await app.request(`/messages?before=${ids[4]}&limit=2`, {
      headers: auth(key),
    });
    const page = await res.json();
    // DESC rowid < ids[4] takes ids[3], ids[2]; reversed to ASC → [ids[2], ids[3]]
    expect(page.map((m: { id: string }) => m.id)).toEqual(ids.slice(2, 4));
  });

  it("returns [] for an unknown before id", async () => {
    const key = await mintKey("pager3");
    await postMsg(key, "hi");
    const res = await app.request(`/messages?before=NOPE`, { headers: auth(key) });
    expect(await res.json()).toEqual([]);
  });

  it("still serves recent history (before absent) — newest msgs land last", async () => {
    const key = await mintKey("pager4");
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(await postMsg(key, `r ${i}`));
    const res = await app.request(`/messages?limit=50`, { headers: auth(key) });
    const page = await res.json();
    const pageIds = page.map((m: { id: string }) => m.id);
    // these 3 are the newest in the db, so they sit at the chronologic tail
    expect(pageIds.slice(-3)).toEqual(ids);
  });
});
