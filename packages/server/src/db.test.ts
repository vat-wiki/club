import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";
import { afterAll,describe, expect, it } from "vitest";

// Performance test: getReactionsForMessages chunks an IN-clause into fixed-arity
// batches so that history pages of hundreds of messages never exceed SQLite's
// 32,767 parameter limit and never blow up SQL string length.
//
// We exercise the function end-to-end through GET /messages with many messages
// (120 > 2 × batch size) and reactions, verifying the API still returns every
// message with its correct aggregated reaction counts.

const dbPath = join(tmpdir(), `club-rxn-batch-${randomUUID()}.db`);
process.env.CLUB_DB = dbPath;

const { messages } = await import("./routes/messages.js");
const { participants } = await import("./routes/participants.js");
const { rooms } = await import("./routes/rooms.js");

const app = new Hono();
app.route("/participants", participants);
app.route("/messages", messages);
app.route("/rooms", rooms);

afterAll(() => {
  for (const ext of ["", "-wal", "-shm"]) rmSync(dbPath + ext, { force: true });
});

async function mint(name: string): Promise<string> {
  const res = await app.request("/participants", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return (await res.json()).key;
}
function auth(key: string) {
  return { "content-type": "application/json", authorization: `Bearer ${key}` };
}
async function postMsg(
  key: string,
  content: string,
  room = "general",
): Promise<any> {
  const res = await app.request("/messages", {
    method: "POST",
    headers: auth(key),
    body: JSON.stringify({ content, room }),
  });
  return { status: res.status, body: await res.json() };
}
async function react(key: string, messageId: string, emoji: string) {
  const res = await app.request(`/messages/${messageId}/reactions`, {
    method: "POST",
    headers: auth(key),
    body: JSON.stringify({ emoji }),
  });
  return { status: res.status };
}

describe("getReactionsForMessages — large-history chunking", () => {
  it("returns correct reaction aggregates for a history page > 2× batch size", async () => {
    // Two participants for reactions on the same message.
    const admin = await mint("batch-admin");
    const p1 = await mint("batch-p1");
    const p2 = await mint("batch-p2");
    const p3 = await mint("batch-p3");

    // 120 messages in a dedicated room ⇒ GET /messages?limit=200 will return
    // all of them in one page. 120 > 2 × 50 (the batch size), so at least 3
    // IN-clause batches fire.
    const room = "batch-room";
    await app.request("/rooms", {
      method: "POST",
      headers: auth(admin),
      body: JSON.stringify({ name: room }),
    });

    const sent: { id: string; content: string }[] = [];
    for (let i = 0; i < 120; i++) {
      const r = await postMsg(admin, `msg ${i}`, room);
      expect(r.status).toBe(201);
      sent.push(r.body);
    }

    // Add reactions using multiple participants on the same messages so we
    // can verify aggregate counts. Only react on every third message to keep
    // the test fast.
    for (let i = 0; i < 120; i += 3) {
      const msg = sent[i];
      await react(p1, msg.id, "👍");
      await react(p2, msg.id, "👍"); // same emoji ⇒ count 2
      await react(p3, msg.id, "🎉"); // different emoji ⇒ count 1
    }

    // Fetch the full history via GET /messages?room=room&limit=200.
    const res = await app.request(`/messages?room=${room}&limit=200`, {
      headers: auth(admin),
    });
    expect(res.status).toBe(200);
    const got = await res.json();

    expect(got).toHaveLength(120);
    for (let i = 0; i < 120; i++) {
      const msg = got[i];
      if (i % 3 === 0) {
        expect(msg.reactions).toBeDefined();
        const emojis = msg.reactions
          .map((r: any) => r.emoji)
          .sort();
        expect( emojis ).toEqual(["🎉", "👍"]);
        const thumb = msg.reactions.find(
          (r: any) => r.emoji === "👍",
        );
        const party = msg.reactions.find(
          (r: any) => r.emoji === "🎉",
        );
        expect(thumb).toEqual({ emoji: "👍", count: 2 });
        expect(party).toEqual({ emoji: "🎉", count: 1 });
      } else {
        // No reactions → field omitted.
        expect(msg.reactions).toBeUndefined();
      }
    }
  });

  it("tolerates an empty message list (no-op)", async () => {
    const key = await mint("batch-empty");
    const emptyRoom = "batch-empty";
    await app.request("/rooms", {
      method: "POST",
      headers: auth(key),
      body: JSON.stringify({ name: emptyRoom }),
    });
    const res = await app.request(`/messages?room=${emptyRoom}&limit=20`, {
      headers: auth(key),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
