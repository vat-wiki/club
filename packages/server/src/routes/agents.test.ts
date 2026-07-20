import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";
import { afterAll, describe, expect, it, vi } from "vitest";

// Point the SQLite DB at a unique temp file BEFORE any module that transitively
// imports db.ts is evaluated. db.ts reads CLUB_DB at import time.
const dbPath = join(tmpdir(), `club-test-${randomUUID()}.db`);
process.env.CLUB_DB = dbPath;

const { agents } = await import("./agents.js");
const { participants } = await import("./participants.js");
const { messages } = await import("./messages.js");
// Capture SSE broadcasts so we can assert event names + payloads. We spy on the
// stream module's broadcast functions rather than driving a real SSE connection
// — that keeps the test focused on the route logic (auth, kind check, idempotence)
// without the overhead of a live subscriber.
const streamMod = await import("../stream.js");

const app = new Hono();
app.route("/participants", participants);
app.route("/agents", agents);
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

function authed(path: string, key: string, method = "POST", body?: unknown) {
  return app.request(path, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: body !== undefined ? JSON.stringify(body) : "{}",
  });
}

describe("POST /agents/thinking and /agents/idle (P1-5)", () => {
  it("requires auth (missing bearer -> 401)", async () => {
    const res = await app.request("/agents/thinking", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("a human key also reports thinking (humans type, agents think)", async () => {
    const spy = vi.spyOn(streamMod, "broadcastAgentThinking").mockImplementation(() => {});
    const key = await mint("alice");
    const res = await authed("/agents/thinking", key);
    expect(res.status).toBe(204);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ name: "alice" }));
    spy.mockRestore();
  });

  it("an agent key broadcasts agent_thinking and returns 204", async () => {
    const spy = vi.spyOn(streamMod, "broadcastAgentThinking").mockImplementation(() => {});
    const key = await mint("rex");
    const res = await authed("/agents/thinking", key);
    expect(res.status).toBe(204);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "rex" }),
    );
    // participantId is the agent's id — verify via the me route shape is overkill;
    // just assert it's a non-empty string carried through.
    expect(spy.mock.calls[0][0].participantId).toBeTruthy();
    spy.mockRestore();
  });

  it("re-reporting while already thinking does NOT re-broadcast (TTL refresh)", async () => {
    const spy = vi.spyOn(streamMod, "broadcastAgentThinking").mockImplementation(() => {});
    const key = await mint("rex2");
    await authed("/agents/thinking", key);
    await authed("/agents/thinking", key); // second report while thinking
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("idle clears thinking and broadcasts agent_idle", async () => {
    const thinkSpy = vi.spyOn(streamMod, "broadcastAgentThinking").mockImplementation(() => {});
    const idleSpy = vi.spyOn(streamMod, "broadcastAgentIdle").mockImplementation(() => {});
    const key = await mint("rex3");
    await authed("/agents/thinking", key);
    await authed("/agents/idle", key);
    expect(idleSpy).toHaveBeenCalledOnce();
    expect(idleSpy.mock.calls[0][0]).toHaveProperty("participantId");
    thinkSpy.mockRestore();
    idleSpy.mockRestore();
  });

  it("idle when not thinking is a no-op (no broadcast, still 204)", async () => {
    const idleSpy = vi.spyOn(streamMod, "broadcastAgentIdle").mockImplementation(() => {});
    const key = await mint("rex4");
    const res = await authed("/agents/idle", key);
    expect(res.status).toBe(204);
    expect(idleSpy).not.toHaveBeenCalled();
    idleSpy.mockRestore();
  });

  it("rejects a body with unexpected fields (strict schema -> 400)", async () => {
    const key = await mint("rex5");
    const res = await authed("/agents/thinking", key, "POST", { bogus: 1 });
    expect(res.status).toBe(400);
  });
});

describe("POST /messages auto-clears a thinking agent (P1-5 safety net)", () => {
  it("broadcasts agent_idle when a thinking agent posts its reply", async () => {
    const thinkSpy = vi.spyOn(streamMod, "broadcastAgentThinking").mockImplementation(() => {});
    const idleSpy = vi.spyOn(streamMod, "broadcastAgentIdle").mockImplementation(() => {});
    const key = await mint("rex6");
    // agent starts thinking, then posts a reply
    await authed("/agents/thinking", key);
    const reply = await authed("/messages", key, "POST", { content: "here is my answer" });
    expect(reply.status).toBe(201);
    // reply-posted auto-clear must have broadcast agent_idle
    expect(idleSpy).toHaveBeenCalledOnce();
    thinkSpy.mockRestore();
    idleSpy.mockRestore();
  });
});
