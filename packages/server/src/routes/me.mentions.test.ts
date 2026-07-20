import { describe, it, expect, afterAll } from "vitest";
import { Hono } from "hono";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

// Point the SQLite DB at a unique temp file BEFORE any module that transitively
// imports db.ts is evaluated. db.ts reads CLUB_DB at import time.
const dbPath = join(tmpdir(), `club-test-${randomUUID()}.db`);
process.env.CLUB_DB = dbPath;

const { me } = await import("./me.js");
const { messages } = await import("./messages.js");
const { participants } = await import("./participants.js");

// Mount the routes this test drives. /me and /messages are auth-gated, so we
// also mount participants (no auth) to mint bearer keys.
const app = new Hono();
app.route("/participants", participants);
app.route("/me", me);
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
  const body = await res.json();
  return body.key;
}

function auth(key: string) {
  return { headers: { Authorization: `Bearer ${key}` } };
}

async function send(key: string, content: string): Promise<{ id: string }> {
  const res = await app.request("/messages", {
    method: "POST",
    headers: { ...auth(key).headers, "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  expect(res.status).toBe(201);
  return res.json();
}

describe("GET /me/mentions (mention inbox)", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await app.request("/me/mentions");
    expect(res.status).toBe(401);
  });

  it("returns [] when nobody has @-mentioned the caller", async () => {
    const alice = await mintKey("inbox-alice-1");
    const res = await app.request("/me/mentions", auth(alice));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("records a mention when another participant @-mentions the caller (offline-safe)", async () => {
    // alice mints a key but never connects a stream — she is "offline". bob
    // sends a message @-mentioning her. The mention must be persisted so she
    // can find it on next poll.
    const alice = await mintKey("inbox-alice-2");
    const bob = await mintKey("inbox-bob-2");
    await send(bob, "hey @inbox-alice-2 please review");

    const res = await app.request("/me/mentions", auth(alice));
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      authorName: "inbox-bob-2",
      content: "hey @inbox-alice-2 please review",
      readAt: null,
    });
    // Exact contract shape: camelCase keys only, no snake_case leak.
    expect(Object.keys(list[0]).sort()).toEqual(
      [
        "id",
        "messageId",
        "participantId",
        "authorId",
        "authorName",
        "content",
        "messageCreatedAt",
        "readAt",
        "room",
      ].sort(),
    );
  });

  it("matches @<name> case-insensitively", async () => {
    const alice = await mintKey("inbox-alice-3");
    const bob = await mintKey("inbox-bob-3");
    await send(bob, "PING @INBOX-ALICE-3");

    const list = await (await app.request("/me/mentions", auth(alice))).json();
    expect(list).toHaveLength(1);
  });

  it("does NOT match a bare name without the @ prefix", async () => {
    const alice = await mintKey("inbox-alice-4");
    const bob = await mintKey("inbox-bob-4");
    await send(bob, "inbox-alice-4 will handle it");

    const list = await (await app.request("/me/mentions", auth(alice))).json();
    expect(list).toEqual([]);
  });

  it("records multiple distinct mentions from a single message", async () => {
    const alice = await mintKey("inbox-alice-5");
    const bob = await mintKey("inbox-bob-5");
    const carol = await mintKey("inbox-carol-5");
    await send(bob, "@inbox-alice-5 and @inbox-carol-5, ping");

    const a = await (await app.request("/me/mentions", auth(alice))).json();
    const c = await (await app.request("/me/mentions", auth(carol))).json();
    expect(a).toHaveLength(1);
    expect(c).toHaveLength(1);
    // bob sent it and wasn't @-mentioned, so his inbox is empty.
    const b = await (await app.request("/me/mentions", auth(bob))).json();
    expect(b).toEqual([]);
  });

  it("mentions a participant at most once per message even if @-repeated", async () => {
    const alice = await mintKey("inbox-alice-6");
    const bob = await mintKey("inbox-bob-6");
    await send(bob, "@inbox-alice-6 @inbox-alice-6 @inbox-alice-6");

    const list = await (await app.request("/me/mentions", auth(alice))).json();
    expect(list).toHaveLength(1);
  });

  it("lists unread mentions oldest-first", async () => {
    const alice = await mintKey("inbox-alice-7");
    const bob = await mintKey("inbox-bob-7");
    await send(bob, "first @inbox-alice-7");
    await send(bob, "second @inbox-alice-7");

    const list = await (await app.request("/me/mentions", auth(alice))).json();
    expect(list).toHaveLength(2);
    expect(list[0].content).toBe("first @inbox-alice-7");
    expect(list[1].content).toBe("second @inbox-alice-7");
    expect(list[0].messageCreatedAt).toBeLessThanOrEqual(list[1].messageCreatedAt);
  });
});

describe("POST /me/mentions/:id/read", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await app.request("/me/mentions/some-id/read", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("marks a mention read and drops it from the unread list", async () => {
    const alice = await mintKey("inbox-alice-8");
    const bob = await mintKey("inbox-bob-8");
    await send(bob, "@inbox-alice-8 read me");

    const before = await (
      await app.request("/me/mentions", auth(alice))
    ).json();
    expect(before).toHaveLength(1);
    const id = before[0].id;

    const markRes = await app.request(`/me/mentions/${id}/read`, {
      method: "POST",
      ...auth(alice),
    });
    expect(markRes.status).toBe(200);
    const marked = await markRes.json();
    expect(marked.readAt).toEqual(expect.any(Number));

    const after = await (
      await app.request("/me/mentions", auth(alice))
    ).json();
    expect(after).toEqual([]);
  });

  it("returns 404 for a non-existent mention id", async () => {
    const alice = await mintKey("inbox-alice-9");
    const res = await app.request("/me/mentions/does-not-exist/read", {
      method: "POST",
      ...auth(alice),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the mention exists but belongs to someone else", async () => {
    // A participant must not be able to mark — or even probe — another's inbox
    // row. Both "not mine" and "truly absent" yield 404 to avoid leaking
    // existence.
    const alice = await mintKey("inbox-alice-10");
    const bob = await mintKey("inbox-bob-10");
    const carol = await mintKey("inbox-carol-10");
    await send(bob, "@inbox-carol-10 hi"); // carol is mentioned, alice is not

    const carolInbox = await (
      await app.request("/me/mentions", auth(carol))
    ).json();
    const id = carolInbox[0].id;

    // alice tries to mark carol's mention — must 404, not 200/403.
    const res = await app.request(`/me/mentions/${id}/read`, {
      method: "POST",
      ...auth(alice),
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 when marking an already-read mention", async () => {
    const alice = await mintKey("inbox-alice-11");
    const bob = await mintKey("inbox-bob-11");
    await send(bob, "@inbox-alice-11 twice");

    const list = await (
      await app.request("/me/mentions", auth(alice))
    ).json();
    const id = list[0].id;

    const first = await app.request(`/me/mentions/${id}/read`, {
      method: "POST",
      ...auth(alice),
    });
    expect(first.status).toBe(200);

    const second = await app.request(`/me/mentions/${id}/read`, {
      method: "POST",
      ...auth(alice),
    });
    expect(second.status).toBe(409);
    expect((await second.json()).error).toMatch(/already read/);
  });
});

describe("POST /me/mentions/read (batch mark-read)", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await app.request("/me/mentions/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: ["x"] }),
    });
    expect(res.status).toBe(401);
  });

  it("marks multiple mentions read in one call", async () => {
    const alice = await mintKey("inbox-alice-12");
    const bob = await mintKey("inbox-bob-12");
    await send(bob, "@inbox-alice-12 first");
    await send(bob, "@inbox-alice-12 second");
    await send(bob, "@inbox-alice-12 third");

    const list = await (await app.request("/me/mentions", auth(alice))).json();
    expect(list).toHaveLength(3);
    const ids = list.map((m) => m.id);

    const res = await app.request("/me/mentions/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
      ...auth(alice),
    });
    expect(res.status).toBe(200);
    const marked = await res.json();
    expect(marked.length).toBe(3);
    // Inbox is now drained.
    const after = await (await app.request("/me/mentions", auth(alice))).json();
    expect(after).toEqual([]);
  });

  it("skips already-read ids and only returns the newly-read rows", async () => {
    const alice = await mintKey("inbox-alice-13");
    const bob = await mintKey("inbox-bob-13");
    await send(bob, "@inbox-alice-13 one");
    await send(bob, "@inbox-alice-13 two");

    const list = await (await app.request("/me/mentions", auth(alice))).json();
    const [m1, m2] = list;

    // Mark m1 first.
    await app.request(`/me/mentions/${m1.id}/read`, { method: "POST", ...auth(alice) });

    // Batch read with m1 (already read) + m2 (unread).
    const res = await app.request("/me/mentions/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [m1.id, m2.id] }),
      ...auth(alice),
    });
    const marked = await res.json();
    // Only m2 was newly read; m1 is excluded from the body.
    expect(marked).toHaveLength(1);
    expect(marked[0].id).toBe(m2.id);
  });

  it("400 when the body is not an array", async () => {
    const alice = await mintKey("inbox-alice-14");
    const res = await app.request("/me/mentions/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wrong: "field" }),
      ...auth(alice),
    });
    expect(res.status).toBe(400);
  });

  it("200 [] for an empty ids array", async () => {
    const alice = await mintKey("inbox-alice-15");
    const res = await app.request("/me/mentions/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [] }),
      ...auth(alice),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
