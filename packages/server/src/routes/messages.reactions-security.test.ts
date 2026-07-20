import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";
import { afterAll,beforeEach, describe, expect, it } from "vitest";

// Fresh temp DB per file so tests don't collide.
const dbPath = join(tmpdir(), `club-msg-react-sec-${randomUUID()}.db`);
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
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

// Minimal message to react to.
async function postMsg(key: string, content = "hello"): Promise<string> {
  const res = await app.request("/messages", {
    method: "POST",
    headers: auth(key),
    body: JSON.stringify({ content }),
  });
  const msg = await res.json();
  return msg.id;
}

describe("messages route — emoji sanitization (security)", () => {
  let key: string;
  let msgId: string;

  beforeEach(async () => {
    key = await mintKey("alice");
    msgId = await postMsg(key);
  });

  // Control characters must be rejected at the server boundary. Direct API
  // clients (curl, SDK, MCP) bypass CLI's sanitizeEmoji() — the server is the
  // last line of defense.
  const controlCases = [
    { emoji: "\x00heart", label: "NUL" },
    { emoji: "heart\x01smile", label: "SOH" },
    { emoji: "he\nart", label: "LF" },
    { emoji: "he\rart", label: "CR" },
    { emoji: "he\tart", label: "TAB" },
    { emoji: "he\x7farmt", label: "DEL" },
    { emoji: "\r\n", label: "CRLF only" },
    { emoji: "\x00", label: "NUL only" },
  ];

  for (const { emoji, label } of controlCases) {
    it(`rejects emoji containing ${label}`, async () => {
      const resp = await app.request(
        `/messages/${msgId}/reactions`,
        {
          method: "POST",
          headers: auth(key),
          body: JSON.stringify({ emoji }),
        },
      );
      // Sanitized emoji is empty → rejected; DB never touched.
      expect(resp.status).toBe(400);
      // Verify no reaction stored with control chars.
      const list = await app.request(`/messages/${msgId}`);
      const body = await list.json();
      const reactions = body.reactions ?? [];
      const dirty = reactions.some((r: any) =>
        /\x00|\n|\r|\t/.test(r.emoji),
      );
      expect(dirty).toBe(false);
    });
  }

  it("accepts a normal emoji", async () => {
    const resp = await app.request(
      `/messages/${msgId}/reactions`,
      {
        method: "POST",
        headers: auth(key),
        body: JSON.stringify({ emoji: "🔥" }),
      },
    );
    expect(resp.status).toBe(204);
  });

  it("trims whitespace and stores the clean emoji", async () => {
    const resp = await app.request(
      `/messages/${msgId}/reactions`,
      {
        method: "POST",
        headers: auth(key),
        body: JSON.stringify({ emoji: "  👍  " }),
      },
    );
    expect(resp.status).toBe(204);
    // Toggle again → removed.
    const resp2 = await app.request(
      `/messages/${msgId}/reactions`,
      {
        method: "POST",
        headers: auth(key),
        body: JSON.stringify({ emoji: "👍" }),
      },
    );
    expect(resp2.status).toBe(204);
  });

  it("rejects empty-only payload", async () => {
    const resp = await app.request(
      `/messages/${msgId}/reactions`,
      {
        method: "POST",
        headers: auth(key),
        body: JSON.stringify({ emoji: "  " }),
      },
    );
    expect(resp.status).toBe(400);
  });
});
