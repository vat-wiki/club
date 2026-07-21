/**
 * POST /messages — replyToId format validation.
 *
 * The Zod schema enforces only length (min 1, max 64). Before this was added,
 * malformed ids (spaces, slashes, control chars) passed Zod and reached
 * getMessageRoom(), producing a silent 404 that looked like a missing message
 * rather than invalid input. These tests confirm the endpoint now rejects
 * malformed replyToId with 400 at the format-validation stage.
 */

import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

const dbPath = join(tmpdir(), `club-replyto-${randomUUID()}.db`);
process.env.CLUB_DB = dbPath;

const { Hono: HonoAgain } = await import("hono");
const { messages } = await import("./messages.js");
const { participants } = await import("./participants.js");

const app = new HonoAgain();
app.route("/participants", participants);
app.route("/messages", messages);

afterAll(() => {
  for (const ext of ["", "-wal", "-shm"]) rmSync(dbPath + ext, { force: true });
});

function auth(key: string) {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

let key = "";
let validMsgId = "";

function uniq(name: string) {
  return `replyto-${name}-${Math.floor(Math.random() * 10000)}`;
}

async function mint() {
  const name = uniq("user");
  const res = await app.request("/participants", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).key;
}

async function postMsg(k: string, content = "hello") {
  const res = await app.request("/messages", {
    method: "POST",
    headers: auth(k),
    body: JSON.stringify({ content }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).id;
}

describe("POST /messages — replyToId format validation", () => {
  beforeEach(async () => {
    key = await mint();
    validMsgId = await postMsg(key);
  });

  const malformedCases = [
    { value: "bad id", label: "space" },
    { value: "bad/id", label: "slash" },
    { value: "bad\nid", label: "newline" },
    { value: "bad\tid", label: "tab" },
    { value: "bad@id", label: "at-sign" },
    { value: "bad:id", label: "colon" },
    { value: "\x00id", label: "NUL prefix" },
    { value: "bad\x7fid", label: "DEL in body" },
  ];

  for (const { value, label } of malformedCases) {
    it(`rejects malformed replyToId ("${label}") with 400`, async () => {
      const res = await app.request("/messages", {
        method: "POST",
        headers: auth(key),
        body: JSON.stringify({ content: "reply", replyToId: value }),
      });
      expect(res.status).toBe(400);
    });
  }

  it("accepts a well-formed replyToId pointing to an existing message in the same room", async () => {
    const res = await app.request("/messages", {
      method: "POST",
      headers: auth(key),
      body: JSON.stringify({ content: "reply", replyToId: validMsgId }),
    });
    expect(res.status).toBe(201);
    const msg = await res.json();
    expect(msg.replyToId).toBe(validMsgId);
  });
});
