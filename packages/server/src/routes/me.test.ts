import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";
import { afterAll, describe, expect, it } from "vitest";

// Point the SQLite DB at a unique temp file BEFORE any module that transitively
// imports db.ts is evaluated. db.ts reads CLUB_DB at import time.
const dbPath = join(tmpdir(), `club-test-${randomUUID()}.db`);
process.env.CLUB_DB = dbPath;

const { me } = await import("./me.js");
const { participants } = await import("./participants.js");
const { rooms } = await import("./rooms.js");
const { messages } = await import("./messages.js");

const app = new Hono();
app.route("/participants", participants);
app.route("/me", me);
app.route("/rooms", rooms);
app.route("/messages", messages);

afterAll(() => {
  for (const ext of ["", "-wal", "-shm"]) rmSync(dbPath + ext, { force: true });
});

// `extractMentionedParticipants` in mention.ts matches on **participant name**,
// not id. Names must be globally unique (POST /participants rejects duplicates
// with 409). We derive a unique name for each participant from a base plus a
// suffix so @-mentions always hit the right recipient.
let participantCounter = 0;
function nextName(base: string): string {
  participantCounter += 1;
  return `${base}-${participantCounter}`;
}

async function mintParticipant(name: string): Promise<{ key: string; id: string; name: string }> {
  const res = await app.request("/participants", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(201);
  const body = await res.json();
  return { key: body.key, id: body.participant.id, name };
}

async function mintKey(name: string): Promise<string> {
  const p = await mintParticipant(name);
  return p.key;
}

function auth(key: string) {
  return { headers: { Authorization: `Bearer ${key}` } };
}

async function createRoom(creatorKey: string, name: string): Promise<string> {
  const res = await app.request("/rooms", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creatorKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).slug;
}

// Posts a message with `@${recipientName}` via the HTTP API. The API auto-
// creates mention rows with valid FK references because it resolves the
// @-mention against the in-memory participant roster.
async function postMention(
  authorKey: string,
  recipientName: string,
  room: string,
): Promise<void> {
  const res = await app.request("/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authorKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ content: `hello @${recipientName}`, room }),
  });
  expect(res.status).toBe(201);
}

describe("GET /me", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await app.request("/me");
    expect(res.status).toBe(401);
  });

  it("returns the authenticated participant (id + name)", async () => {
    const aliceKey = await mintKey("get-me-alice");
    const res = await app.request("/me", auth(aliceKey));
    expect(res.status).toBe(200);
    const me = await res.json();
    expect(me.name).toBe("get-me-alice");
    expect(me.id).toBeDefined();
    expect(typeof me.id).toBe("string");
    expect(me.id).not.toBe("");
  });

  it("returns the same identity for every call within a session", async () => {
    const bobKey = await mintKey("get-me-bob");
    const first = await (await app.request("/me", auth(bobKey))).json();
    const second = await (await app.request("/me", auth(bobKey))).json();
    expect(first.id).toBe(second.id);
    expect(first.name).toBe(second.name);
  });

  it("isolates identity between participants (no key leakage)", async () => {
    const aliceKey = await mintKey("get-me-isolate-a");
    const bobKey = await mintKey("get-me-isolate-b");
    const alice = await (await app.request("/me", auth(aliceKey))).json();
    const bob = await (await app.request("/me", auth(bobKey))).json();
    expect(alice.id).not.toBe(bob.id);
    expect(alice.name).toBe("get-me-isolate-a");
    expect(bob.name).toBe("get-me-isolate-b");
  });

  it("rejects an invalid bearer token", async () => {
    const res = await app.request("/me", {
      headers: { Authorization: "Bearer not-a-real-key" },
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /me/mentions", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await app.request("/me/mentions");
    expect(res.status).toBe(401);
  });

  it("returns empty list when no mentions exist", async () => {
    const key = await mintKey("mentions-empty");
    const res = await app.request("/me/mentions", auth(key));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns unread mentions ordered oldest first", async () => {
    const recipient = await mintParticipant(nextName("mentions-oldest-recip"));
    const author = await mintParticipant(nextName("mentions-oldest-author"));
    const room = await createRoom(author.key, nextName("oldest-room"));
    // Two @-mentions in two separate messages; the API creates mention rows
    // with valid FK references.
    await postMention(author.key, recipient.name, room);
    await postMention(author.key, recipient.name, room);
    const res = await app.request("/me/mentions", auth(recipient.key));
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBeDefined();
    expect(list[1].id).toBeDefined();
    expect(list[0].messageCreatedAt).toBeLessThanOrEqual(list[1].messageCreatedAt);
  });
});

describe("POST /me/mentions/:id/read", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await app.request("/me/mentions/not-found/read", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 for a non-existent mention id", async () => {
    const key = await mintKey("mentions-not-found");
    const res = await app.request("/me/mentions/nonexistent/read", {
      method: "POST",
      ...auth(key),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a mention owned by another participant", async () => {
    const author = await mintParticipant(nextName("mentions-own-author"));
    const bob = await mintParticipant(nextName("mentions-own-bob"));
    const alice = await mintParticipant(nextName("mentions-own-alice"));
    const room = await createRoom(author.key, nextName("own-test-room"));
    // Author mentions alice; bob tries to read that mention.
    await postMention(author.key, alice.name, room);
    const mentions = await (await app.request("/me/mentions", auth(alice.key))).json();
    const target = mentions[0];
    const res = await app.request(`/me/mentions/${target.id}/read`, {
      method: "POST",
      ...auth(bob.key),
    });
    expect(res.status).toBe(404);
  });

  it("marks a mention as read and returns the updated shape", async () => {
    const author = await mintParticipant(nextName("mentions-read-author"));
    const recipient = await mintParticipant(nextName("mentions-read-recip"));
    const room = await createRoom(author.key, nextName("read-test-room"));
    await postMention(author.key, recipient.name, room);
    const mentions = await (await app.request("/me/mentions", auth(recipient.key))).json();
    const id = mentions[0].id;
    const res = await app.request(`/me/mentions/${id}/read`, {
      method: "POST",
      ...auth(recipient.key),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(id);
    expect(body.readAt).toBeDefined();
    expect(typeof body.readAt).toBe("number");
  });

  it("returns 409 when the mention was already read", async () => {
    const author = await mintParticipant(nextName("mentions-409-author"));
    const recipient = await mintParticipant(nextName("mentions-409-recip"));
    const room = await createRoom(author.key, nextName("409-test-room"));
    await postMention(author.key, recipient.name, room);
    const mentions = await (await app.request("/me/mentions", auth(recipient.key))).json();
    const id = mentions[0].id;
    // Read it once
    await app.request(`/me/mentions/${id}/read`, {
      method: "POST",
      ...auth(recipient.key),
    });
    // Try again — should be 409
    const res = await app.request(`/me/mentions/${id}/read`, {
      method: "POST",
      ...auth(recipient.key),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("already");
  });
});

describe("POST /me/mentions/read (batch)", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await app.request("/me/mentions/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [] }),
    });
    expect(res.status).toBe(401);
  });

  it("returns empty list for an empty ids array", async () => {
    const key = await mintKey("mentions-batch-empty");
    const res = await app.request("/me/mentions/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...auth(key),
      body: JSON.stringify({ ids: [] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("marks only readable mentions and silently skips others", async () => {
    const author = await mintParticipant(nextName("mentions-batch-author"));
    const alice = await mintParticipant(nextName("mentions-batch-a"));
    const bob = await mintParticipant(nextName("mentions-batch-b"));
    const room = await createRoom(author.key, nextName("batch-test-room"));
    await postMention(author.key, alice.name, room);
    await postMention(author.key, bob.name, room);
    const aliceMentions = await (
      await app.request("/me/mentions", auth(alice.key))
    ).json();
    const mine = aliceMentions[0].id;
    const res = await app.request("/me/mentions/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...auth(alice.key),
      // Send alice's mention + bob's mention id in one request. Alice can
      // only mark her own mention as read; bob's mention is silently skipped.
      body: JSON.stringify({ ids: [mine, "unknown"] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(mine);
  });
});
