import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";
import { afterAll,describe, expect, it } from "vitest";

// Isolated DB so sanitization tests can't leak into the shared e2e suites.
const dbPath = join(tmpdir(), `club-msg-san-${randomUUID()}.db`);
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

describe("POST /messages sanitization", () => {
  let key: string;

  it("sanitizes control characters out of message content", async () => {
    key = await mintKey("human");
    const res = await app.request("/messages", {
      method: "POST",
      headers: { "content-type": "application/json", ...auth(key) },
      body: JSON.stringify({ content: "hello\x00\x1fworld\n" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; content: string };
    // NUL, unit separator, etc. stripped; LF preserved.
    expect(body.content).toBe("helloworld\n");
  });

  it("stores the sanitized content (DB reflects what the client sees)", async () => {
    // Read the message back via GET to confirm DB was written with the clean
    // copy, not the raw payload. Use before=<sentinel> to pull the latest
    // message without a race.
    const res = await app.request(
      `/messages?room=general&limit=1`,
      { method: "GET", headers: auth(key) },
    );
    expect(res.status).toBe(200);
    const list = (await res.json()) as { content: string }[];
    expect(list.length).toBeGreaterThan(0);
    const latest = list[0];
    expect(latest.content).toBe("helloworld\n");
  });

  it("rejects a text-only payload that sanitizes to empty", async () => {
    const res = await app.request("/messages", {
      method: "POST",
      headers: { "content-type": "application/json", ...auth(key) },
      body: JSON.stringify({ content: "\x00\x03\x1f" }), // all control chars
    });
    expect(res.status).toBe(400);
  });

  it("preserves CRLF, TAB, and CJK through sanitization", async () => {
    const inVal = "line1\nline2\r\nline3\ttabbed 你好🎉";
    const res = await app.request("/messages", {
      method: "POST",
      headers: { "content-type": "application/json", ...auth(key) },
      body: JSON.stringify({ content: inVal }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { content: string };
    expect(body.content).toBe(inVal);
  });
});
