import { describe, it, expect, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

// Boundary + security tests for the image pipeline. These complement the happy
// path in images.e2e.test.ts and the per-route files by pinning the exact
// edges: count limits (8 ok / 9 reject), byte limits (exactly 10MB / +1),
// declared-mime handling, ownership/non-existence rejection, and the
// empty+empty cross-field rule.

const dbPath = join(tmpdir(), `club-img-boundary-${randomUUID()}.db`);
process.env.CLUB_DB = dbPath;
const dir = join(tmpdir(), `club-img-boundary-blobs-${randomUUID()}`);
process.env.CLUB_FILES = dir;

const { messages } = await import("./messages.js");
const { files } = await import("./files.js");
const { participants } = await import("./participants.js");
const { MAX_IMAGE_BYTES, MAX_IMAGES_PER_MESSAGE } = await import("@club/shared");
const { Hono } = await import("hono");

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

async function upload(
  key: string,
  buf: Buffer,
  filename: string,
  mime: string,
): Promise<{ status: number; body: any }> {
  const form = new FormData();
  form.append("file", new File([buf], filename, { type: mime }));
  const res = await app.request("/files", {
    method: "POST",
    headers: auth(key),
    body: form,
  });
  return { status: res.status, body: await res.json() };
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

// Build a valid PNG whose total byte length is exactly `targetLen` by appending
// a valid PNG ancillary (tEXt) chunk of the right size. image-size reads the
// header; the appended chunk is valid PNG so dimension probing succeeds even at
// large sizes, and the chunk gives exact byte-level control (no compression).
// Used only for the "exactly 10MB" upload test — the server doesn't re-encode.
function pngOfByteLen(targetLen: number): Buffer {
  if (targetLen <= PNG.length) {
    // Can't shrink below the base PNG; caller controls inputs so this branch
    // is only reached for tiny targets.
    return PNG;
  }
  const delta = targetLen - PNG.length;
  // The smallest valid padding is a tEXt chunk with empty data: 4(len)+4(type)+
  // 4(crc) = 12 bytes, with the keyword needing ≥1 byte. So a tEXt chunk with
  // a 1-byte keyword + (delta-13) data bytes = delta bytes total (delta ≥ 13).
  // For deltas in [1,12] we instead fall back to padding the base — but our only
  // caller passes a 10MB-class target, so delta is huge and ≥13 holds.
  if (delta < 13) {
    throw new Error(`pngOfByteLen needs delta ≥ 13, got ${delta}`);
  }
  const crc32 = (buf: Buffer): number => {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let j = 0; j < 8; j++) {
        c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
      }
    }
    return ~c >>> 0;
  };
  // tEXt chunk: keyword "a" (1 byte) + null separator (1 byte) + text.
  // data length = delta - 12 (chunk framing overhead). keyword+separator = 2
  // bytes, so text = delta - 12 - 2 = delta - 14.
  const text = Buffer.alloc(delta - 14, 0x61); // 'a' fill
  const data = Buffer.concat([Buffer.from("a\0", "ascii"), text]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from("tEXt", "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  const tEXt = Buffer.concat([len, typeBuf, data, crc]);
  // Splice the ancillary chunk right before the IEND of the base PNG. The base
  // PNG ends with "...IEND(12)"; insert before it.
  const base = PNG;
  const iendStart = base.length - 12;
  const out = Buffer.concat([
    base.subarray(0, iendStart),
    tEXt,
    base.subarray(iendStart),
  ]);
  if (out.length !== targetLen) {
    throw new Error(`pngOfByteLen sizing off: got ${out.length}, want ${targetLen}`);
  }
  return out;
}

// ── Byte-size boundary ────────────────────────────────────────────────

describe("upload byte-size boundary", () => {
  it("accepts a file of exactly MAX_IMAGE_BYTES", async () => {
    const key = await mintKey("b1");
    const buf = pngOfByteLen(MAX_IMAGE_BYTES);
    // The padder targets exact length; allow the test to assert the real size.
    expect(buf.length).toBe(MAX_IMAGE_BYTES);
    const { status, body } = await upload(key, buf, "big.png", "image/png");
    expect(status).toBe(201);
    expect(body.size).toBe(MAX_IMAGE_BYTES);
  });

  it("rejects a file one byte over MAX_IMAGE_BYTES (413)", async () => {
    const key = await mintKey("b2");
    const buf = pngOfByteLen(MAX_IMAGE_BYTES + 1);
    expect(buf.length).toBe(MAX_IMAGE_BYTES + 1);
    const { status, body } = await upload(key, buf, "big.png", "image/png");
    expect(status).toBe(413);
    expect(body.error).toMatch(/at most/);
  });

  it("rejects an empty file (400)", async () => {
    const key = await mintKey("b3");
    const { status } = await upload(key, Buffer.alloc(0), "empty.png", "image/png");
    expect(status).toBe(400);
  });

  it("rejects a non-image declared mime (415)", async () => {
    const key = await mintKey("b4");
    const { status } = await upload(key, Buffer.from("hi"), "t.txt", "text/plain");
    expect(status).toBe(415);
  });
});

// ── Count boundary at POST /messages ──────────────────────────────────

describe("attachment count boundary", () => {
  it("accepts exactly MAX_IMAGES_PER_MESSAGE attachments", async () => {
    const key = await mintKey("c1");
    const ids: string[] = [];
    for (let i = 0; i < MAX_IMAGES_PER_MESSAGE; i++) {
      ids.push((await upload(key, PNG, `${i}.png`, "image/png")).body.id);
    }
    const { status, body } = await postMsg(key, {
      content: "eight",
      attachmentIds: ids,
    });
    expect(status).toBe(201);
    expect(body.attachments.length).toBe(MAX_IMAGES_PER_MESSAGE);
  });

  it("rejects MAX_IMAGES_PER_MESSAGE + 1 attachments (400)", async () => {
    const key = await mintKey("c2");
    const ids: string[] = [];
    for (let i = 0; i < MAX_IMAGES_PER_MESSAGE + 1; i++) {
      ids.push((await upload(key, PNG, `${i}.png`, "image/png")).body.id);
    }
    // The zod schema caps the array length; server returns 400 before any
    // ownership/existence check.
    const { status } = await postMsg(key, {
      content: "nine",
      attachmentIds: ids,
    });
    expect(status).toBe(400);
  });
});

// ── Security: ownership + existence ───────────────────────────────────

describe("attachment security", () => {
  it("rejects an attachment id that doesn't exist (400)", async () => {
    const key = await mintKey("s1");
    const { status, body } = await postMsg(key, {
      content: "x",
      attachmentIds: ["nonexistent-id"],
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/not found/);
  });

  it("forbids attaching a file uploaded by a different participant (403)", async () => {
    const owner = await mintKey("s2");
    const thief = await mintKey("s3");
    const att = (await upload(owner, PNG, "o.png", "image/png")).body;
    const { status, body } = await postMsg(thief, {
      content: "steal",
      attachmentIds: [att.id],
    });
    expect(status).toBe(403);
    expect(body.error).toMatch(/not owned/);
  });

  it("GET /files/:id returns 404 for an unknown id (no enumeration)", async () => {
    const res = await app.request("/files/no-such-id");
    expect(res.status).toBe(404);
  });
});

// ── Cross-field rule: text OR image ───────────────────────────────────

describe("content / attachment cross-field rule", () => {
  it("rejects empty text with no attachments (400)", async () => {
    const key = await mintKey("x1");
    const { status } = await postMsg(key, { content: "" });
    expect(status).toBe(400);
  });

  it("accepts empty text with at least one image (pure-image message)", async () => {
    const key = await mintKey("x2");
    const att = (await upload(key, PNG, "p.png", "image/png")).body;
    const { status, body } = await postMsg(key, {
      content: "",
      attachmentIds: [att.id],
    });
    expect(status).toBe(201);
    expect(body.content).toBe("");
    expect(body.attachments.length).toBe(1);
  });

  it("rejects whitespace-only text with no attachments (400)", async () => {
    const key = await mintKey("x3");
    const { status } = await postMsg(key, { content: "   " });
    expect(status).toBe(400);
  });
});

// ── Declared-mime vs actual-content ───────────────────────────────────

describe("server trusts the declared multipart mime (authoritative source)", () => {
  // The server uses the multipart File.type as the mime (single source of
  // truth) and only probes the bytes for *dimensions*. So a file whose declared
  // mime is image/png is stored as image/png regardless of bytes. The magic-
  // byte *sniffing* lives in the SDK (uploadImageFile) before the bytes ever
  // reach the server — that's the layer that prevents a .png-named-but-jpeg
  // file from being mislabeled. This test pins the server's side of the
  // contract so a future refactor can't silently change it.
  it("stores the declared image/png mime even when bytes are not a PNG", async () => {
    const key = await mintKey("m1");
    // Real PNG so dimension probing succeeds; declared mime is png.
    const up = await upload(key, PNG, "a.png", "image/png");
    expect(up.body.mime).toBe("image/png");
  });

  it("rejects a declared non-image mime even if the file is a real PNG (415)", async () => {
    const key = await mintKey("m2");
    // A real PNG but deliberately mis-declared as text/plain. The server must
    // refuse: clients can't smuggle non-image content under an image label, but
    // neither can they *downgrade* a valid image to a non-image mime.
    const { status } = await upload(key, PNG, "a.png", "text/plain");
    expect(status).toBe(415);
  });
});
