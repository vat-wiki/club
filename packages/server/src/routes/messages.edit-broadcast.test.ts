/**
 * PATCH /messages/:id - `message_edited` SSE broadcast.
 *
 * Editing a message must broadcast a channel-scoped `message_edited` event so
 * every live SSE subscriber swaps the row in by id (replacing content/editedAt)
 * rather than waiting for a history poll. These tests spy on the stream module's
 * `broadcastEdited` (the same vi.spyOn pattern used by channels.test.ts /
 * agents.test.ts for `broadcastDeleted` / `broadcastReaction`) to assert the
 * event is fired with the refreshed message + the right channel.
 */

import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fresh temp DB per file so tests don't collide.
const dbPath = join(tmpdir(), `club-msg-edit-${randomUUID()}.db`);
process.env.CLUB_DB = dbPath;

const { messages } = await import("./messages.js");
const { participants } = await import("./participants.js");
const streamMod = await import("../stream.js");

const app = new Hono();
app.route("/participants", participants);
app.route("/messages", messages);

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

async function postMsg(key: string, content: string, channel?: string): Promise<any> {
  const body: Record<string, unknown> = { content };
  if (channel) body.channel = channel;
  const res = await app.request("/messages", {
    method: "POST",
    headers: auth(key),
    body: JSON.stringify(body),
  });
  return await res.json();
}

describe("PATCH /messages/:id - message_edited SSE broadcast", () => {
  let key: string;
  let otherKey: string;
  let msg: any;

  beforeEach(async () => {
    // Unique names per test (participant names are unique; reusing one makes
    // the second mint 409 and cascade into a misleading 401).
    key = await mint(`edit-broadcaster-${Math.random().toString(36).slice(2, 10)}`);
    otherKey = await mint(`edit-other-${Math.random().toString(36).slice(2, 10)}`);
    msg = await postMsg(key, "original", "edit-room");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("broadcasts a message_edited event with the refreshed message + channel", async () => {
    const spy = vi.spyOn(streamMod, "broadcastEdited").mockImplementation(() => {});

    const res = await app.request(`/messages/${msg.id}`, {
      method: "PATCH",
      headers: auth(key),
      body: JSON.stringify({ content: "edited body" }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.content).toBe("edited body");
    expect(typeof body.editedAt).toBe("number");
    expect(body.editedAt).toBeGreaterThan(0);

    // Exactly one message_edited broadcast, carrying the swapped message + the
    // channel so the SSE fan-out stays channel-scoped (MR10).
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          id: msg.id,
          content: "edited body",
          channel: "edit-room",
        }),
        channel: "edit-room",
      }),
    );
    // The broadcast message must carry the populated editedAt.
    expect(spy.mock.calls[0][0].message.editedAt).toBe(body.editedAt);
    spy.mockRestore();
  });

  it("does NOT broadcast when the edit fails (not the author -> 404)", async () => {
    const spy = vi.spyOn(streamMod, "broadcastEdited").mockImplementation(() => {});

    // otherKey does not own msg -> updateMessage rejects -> 404, no broadcast.
    const res = await app.request(`/messages/${msg.id}`, {
      method: "PATCH",
      headers: auth(otherKey),
      body: JSON.stringify({ content: "hijack" }),
    });
    expect(res.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("broadcasts the channel-scoped edit for a non-general channel", async () => {
    const spy = vi.spyOn(streamMod, "broadcastEdited").mockImplementation(() => {});

    const res = await app.request(`/messages/${msg.id}`, {
      method: "PATCH",
      headers: auth(key),
      body: JSON.stringify({ content: "scoped edit" }),
    });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledOnce();
    // channel must match the message's channel (edit-room), not DEFAULT_CHANNEL,
    // so a client watching another channel never receives this edit.
    expect(spy.mock.calls[0][0].channel).toBe("edit-room");
    spy.mockRestore();
  });
});
