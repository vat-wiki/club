import { describe, it, expect, afterAll } from "vitest";
import { Hono } from "hono";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const dbPath = join(tmpdir(), `club-msg-att-${randomUUID()}.db`);
process.env.CLUB_DB = dbPath;
const dir = join(tmpdir(), `club-msg-att-blobs-${randomUUID()}`);
process.env.CLUB_FILES = dir;

const { messages } = await import("./messages.js");
const { files } = await import("./files.js");
const { participants } = await import("./participants.js");

const app = new Hono();
app.route("/participants", participants);
app.route("/files", files);
app.route("/messages", messages);

afterAll(() => {
  for (const ext of ["", "-wal", "-shm"]) rmSync(dbPath + ext, { force: true });
  rmSync(dir, { recursive: true, force: true });
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

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function upload(key: string): Promise<{ id: string; url: string }> {
  const form = new FormData();
  form.append("file", new File([PNG], "t.png", { type: "image/png" }));
  const res = await app.request("/files", {
    method: "POST",
    headers: auth(key),
    body: form,
  });
  return await res.json();
}

async function postMsg(
  key: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  const res = await app.request("/messages", {
    method: "POST",
    headers: { ...auth(key), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe("POST /messages with attachments", () => {
  it("attaches a previously uploaded file and echoes server-built attachments", async () => {
    const key = await mintKey("a1");
    const att = await upload(key);
    const { status, body } = await postMsg(key, {
      content: "look",
      attachmentIds: [att.id],
    });
    expect(status).toBe(201);
    expect(body.attachments).toEqual([
      expect.objectContaining({
        id: att.id,
        url: `/files/${att.id}`,
        mime: "image/png",
        size: PNG.length,
      }),
    ]);
  });

  it("allows empty text with at least one image (text-optional rule)", async () => {
    const key = await mintKey("a2");
    const att = await upload(key);
    const { status, body } = await postMsg(key, {
      content: "",
      attachmentIds: [att.id],
    });
    expect(status).toBe(201);
    expect(body.content).toBe("");
    expect(body.attachments.length).toBe(1);
  });

  it("rejects empty text with no attachments (400)", async () => {
    const key = await mintKey("a3");
    const { status } = await postMsg(key, { content: "" });
    expect(status).toBe(400);
  });

  it("rejects a non-existent attachment id (400)", async () => {
    const key = await mintKey("a4");
    const { status } = await postMsg(key, {
      content: "x",
      attachmentIds: ["nope"],
    });
    expect(status).toBe(400);
  });

  it("forbids attaching a file owned by another participant (403)", async () => {
    const owner = await mintKey("a5");
    const thief = await mintKey("a6");
    const att = await upload(owner); // owner uploads
    const { status } = await postMsg(thief, {
      content: "steal",
      attachmentIds: [att.id],
    });
    expect(status).toBe(403);
  });

  it("persists attachments so GET /messages rehydrates them", async () => {
    const key = await mintKey("a7");
    const att = await upload(key);
    await postMsg(key, { content: "persist me", attachmentIds: [att.id] });
    const res = await app.request("/messages?limit=5", { headers: auth(key) });
    const list = await res.json();
    const mine = list.find((m: any) => m.content === "persist me");
    expect(mine.attachments[0].id).toBe(att.id);
    expect(mine.attachments[0].mime).toBe("image/png");
  });

  it("keeps attachmentIds order in the echoed attachments", async () => {
    const key = await mintKey("a8");
    const a = await upload(key);
    const b = await upload(key);
    const { body } = await postMsg(key, {
      content: "two",
      attachmentIds: [b.id, a.id], // deliberately non-creation order
    });
    expect(body.attachments.map((x: any) => x.id)).toEqual([b.id, a.id]);
  });
});
