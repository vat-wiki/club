import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";
import { afterAll,describe, expect, it } from "vitest";

import { MAX_VIDEO_BYTES } from "@vatwiki/shared";

// Isolated temp DB + blob dir per file (db.ts reads CLUB_DB / files-dir reads
// CLUB_FILES at import time, so we set env before the dynamic imports below).
const dbPath = join(tmpdir(), `club-files-${randomUUID()}.db`);
process.env.CLUB_DB = dbPath;
const dir = join(tmpdir(), `club-files-blobs-${randomUUID()}`);
process.env.CLUB_FILES = dir;

const { files } = await import("./files.js");
const { participants } = await import("./participants.js");

const app = new Hono();
app.route("/participants", participants);
app.route("/files", files);

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

// A real 1x1 PNG so image-size can probe dimensions.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function pngFile(): File {
  return new File([PNG_1x1], "t.png", { type: "image/png" });
}

async function upload(
  key: string,
  file: File,
): Promise<{ status: number; body: any }> {
  const form = new FormData();
  form.append("file", file);
  const res = await app.request("/files", {
    method: "POST",
    headers: auth(key),
    body: form,
  });
  return { status: res.status, body: await res.json() };
}

describe("POST /files", () => {
  it("rejects without auth (401)", async () => {
    const form = new FormData();
    form.append("file", pngFile());
    const res = await app.request("/files", { method: "POST", body: form });
    expect(res.status).toBe(401);
  });

  it("accepts a valid png, returns authoritative attachment metadata", async () => {
    const key = await mintKey("u1");
    const { status, body } = await upload(key, pngFile());
    expect(status).toBe(201);
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(body.url).toBe(`/files/${body.id}`);
    expect(body.mime).toBe("image/png");
    expect(body.width).toBe(1);
    expect(body.height).toBe(1);
    expect(body.size).toBe(PNG_1x1.length);
  });

  it("rejects a non-image mime (415)", async () => {
    const key = await mintKey("u2");
    const file = new File(["hello"], "t.txt", { type: "text/plain" });
    const { status } = await upload(key, file);
    expect(status).toBe(415);
  });

  it("rejects a missing file field (400)", async () => {
    const key = await mintKey("u3");
    const res = await app.request("/files", {
      method: "POST",
      headers: auth(key),
      body: new FormData(),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /files/:id", () => {
  it("serves the blob WITHOUT auth and sets immutable cache headers", async () => {
    const key = await mintKey("u4");
    const { body } = await upload(key, pngFile());
    const res = await app.request(`/files/${body.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe(
      "public, immutable, max-age=31536000",
    );
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.equals(PNG_1x1)).toBe(true);
  });

  it("404s for an unknown id", async () => {
    const res = await app.request("/files/does-not-exist");
    expect(res.status).toBe(404);
  });
});

// ── Video branch ──────────────────────────────────────────────────────
// An arbitrary buffer standing in for a video. The server's video branch does
// NOT probe container metadata (unlike images, which parse dimensions via
// image-size), so the bytes' content is irrelevant — only mime + size are
// checked. This lets us exercise the whole video pipeline without a real (and
// large) mp4/webm fixture.
// Magic-byte prefixes recognized by detectAndVerifyMime for video. The
// rest of the buffer is just padding (the detector only inspects the header),
// so we prefix the counter pattern used below with the right signature.
//   MP4 : offset 4 = "ftyp" (ISO BMFF box)
//   WebM: 0x1A45DFA3 (EBML) at offset 0
const MP4_MAGIC = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const WEBM_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00]);

// Default MP4-shaped payload: 1000 bytes (well under MAX_VIDEO_BYTES) with a
// valid ftyp magic header so MIME sniffing accepts it. The counter pattern is
// kept in the tail so Range assertions can still slice & compare exact bytes.
const VIDEO_BYTES = Buffer.alloc(1000, 0);
MP4_MAGIC.copy(VIDEO_BYTES, 0);
for (let i = MP4_MAGIC.length; i < VIDEO_BYTES.length; i++) VIDEO_BYTES[i] = i % 256;

// Build a buffer with the magic for the requested container followed by the
// same counter tail, so each video kind passes its own magic-byte check.
function videoBytes(mime: string): Buffer {
  const magic = mime === "video/webm" ? WEBM_MAGIC : MP4_MAGIC;
  const buf = Buffer.alloc(1000, 0);
  magic.copy(buf, 0);
  for (let i = magic.length; i < buf.length; i++) buf[i] = i % 256;
  return buf;
}

function videoFile(
  mime = "video/mp4",
  name = "v.mp4",
  bytes?: Buffer,
): File {
  return new File([bytes ?? videoBytes(mime)], name, { type: mime });
}

describe("POST /files — video branch", () => {
  it("accepts an mp4 and returns metadata WITHOUT probed dimensions", async () => {
    const key = await mintKey("v1");
    const { status, body } = await upload(key, videoFile("video/mp4"));
    expect(status).toBe(201);
    expect(body.mime).toBe("video/mp4");
    // Unlike images, video attachments carry no width/height — the <video>
    // element reads its own dimensions client-side.
    expect(body.width).toBeUndefined();
    expect(body.height).toBeUndefined();
    expect(body.size).toBe(VIDEO_BYTES.length);
    expect(body.url).toBe(`/files/${body.id}`);
  });

  it("accepts a webm", async () => {
    const key = await mintKey("v2");
    const { status, body } = await upload(key, videoFile("video/webm"));
    expect(status).toBe(201);
    expect(body.mime).toBe("video/webm");
  });

  it("rejects a non-whitelisted video container (415)", async () => {
    const key = await mintKey("v3");
    const { status } = await upload(key, videoFile("video/quicktime"));
    expect(status).toBe(415);
  });

  it("rejects a video over MAX_VIDEO_BYTES (413)", async () => {
    const key = await mintKey("v4");
    const tooBig = Buffer.alloc(MAX_VIDEO_BYTES + 1, 0);
    const { status } = await upload(key, videoFile("video/mp4", "big.mp4", tooBig));
    expect(status).toBe(413);
  });
});

describe("GET /files/:id — HTTP Range (video seek)", () => {
  it("advertises Accept-Ranges and serves the full body on a plain GET", async () => {
    const key = await mintKey("r1");
    const { body } = await upload(key, videoFile());
    const res = await app.request(`/files/${body.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.equals(VIDEO_BYTES)).toBe(true);
  });

  it("returns 206 + the requested byte slice on a Range request", async () => {
    const key = await mintKey("r2");
    const { body } = await upload(key, videoFile());
    const res = await app.request(`/files/${body.id}`, {
      headers: { Range: "bytes=10-19" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(
      `bytes 10-19/${VIDEO_BYTES.length}`,
    );
    expect(res.headers.get("content-length")).toBe("10");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.equals(VIDEO_BYTES.subarray(10, 20))).toBe(true);
  });

  it("returns 206 to the end on an open-ended Range (bytes=990-)", async () => {
    const key = await mintKey("r3");
    const { body } = await upload(key, videoFile());
    const res = await app.request(`/files/${body.id}`, {
      headers: { Range: "bytes=990-" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(
      `bytes 990-999/${VIDEO_BYTES.length}`,
    );
    expect(res.headers.get("content-length")).toBe("10");
  });

  it("serves the last N bytes on a suffix Range (bytes=-10)", async () => {
    const key = await mintKey("r5");
    const { body } = await upload(key, videoFile());
    const res = await app.request(`/files/${body.id}`, {
      headers: { Range: "bytes=-10" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(
      `bytes 990-999/${VIDEO_BYTES.length}`,
    );
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.equals(VIDEO_BYTES.subarray(990))).toBe(true);
  });

  it("returns 416 for an unsatisfiable Range", async () => {
    const key = await mintKey("r4");
    const { body } = await upload(key, videoFile());
    const res = await app.request(`/files/${body.id}`, {
      headers: { Range: `bytes=${VIDEO_BYTES.length + 10}-` },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(
      `bytes */${VIDEO_BYTES.length}`,
    );
  });
});

// ── Document branch ──────────────────────────────────────────────────
// Arbitrary bytes + a document mime. Like video, the server doesn't probe
// document content — it records mime + filename + size and stores the bytes
// verbatim. The filename comes from the multipart part's name (sanitized).
const DOC_BYTES = Buffer.from("%PDF-1.4 arbitrary document body");
// ZIP local-file-header magic — docx / xlsx are OOXML (ZIP) containers, so
// detectAndVerifyMime only accepts them when the bytes start with PK\x03\x04.
const ZIP_DOC_BYTES = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]), // PK\x03\x04
  Buffer.from("rest-of-ooxml-payload"),
]);
// Plain text payload for text/markdown (no magic; detector treats it as text).
const TEXT_DOC_BYTES = Buffer.from("# title\n\nsome markdown body");

function docFile(mime: string, name: string): File {
  // Pick bytes whose magic matches the claimed MIME so detectAndVerifyMime
  // accepts the upload instead of 415-ing on a header/payload mismatch.
  const bytes =
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      ? ZIP_DOC_BYTES
      : mime === "text/markdown"
        ? TEXT_DOC_BYTES
        : DOC_BYTES;
  return new File([bytes], name, { type: mime });
}

describe("POST /files — document branch", () => {
  it("accepts a pdf and echoes the sanitized filename", async () => {
    const key = await mintKey("d1");
    const { status, body } = await upload(
      key,
      docFile("application/pdf", "report.pdf"),
    );
    expect(status).toBe(201);
    expect(body.mime).toBe("application/pdf");
    expect(body.size).toBe(DOC_BYTES.length);
    expect(body.filename).toBe("report.pdf");
    expect(body.url).toBe(`/files/${body.id}`);
    // Documents carry no width/height (only images are probed).
    expect(body.width).toBeUndefined();
    expect(body.height).toBeUndefined();
  });

  it("strips a directory component from the filename", async () => {
    const key = await mintKey("d2");
    const { body } = await upload(
      key,
      // A client shouldn't send a path, but if it does we keep only the basename.
      docFile("application/pdf", "../../etc/passwd.pdf"),
    );
    expect(body.filename).toBe("passwd.pdf");
  });

  it("accepts docx / xlsx / md", async () => {
    const key = await mintKey("d3");
    const cases: Array<[string, string]> = [
      ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx"],
      ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "a.xlsx"],
      ["text/markdown", "a.md"],
    ];
    for (const [mime, name] of cases) {
      const { status, body } = await upload(key, docFile(mime, name));
      expect(status).toBe(201);
      expect(body.mime).toBe(mime);
      expect(body.filename).toBe(name);
    }
  });

  it("rejects a non-whitelisted document type (415)", async () => {
    const key = await mintKey("d4");
    const { status } = await upload(key, docFile("application/zip", "a.zip"));
    expect(status).toBe(415);
  });
});

// ── Filename sanitization (control characters) ────────────────────────
// Server-side display metadata only, but control chars (\x00, CRLF, BEL,
// DEL) would break downstream JSON, HTML, or audit-log rendering if stored
// verbatim. The upload handler strips them.

describe("POST /files — filename control-character sanitization", () => {
  function controlFile(name: string, mime = "application/pdf"): File {
    return new File([DOC_BYTES], name, { type: mime });
  }

  it("rejects NUL byte in filename and returns the cleaned basename", async () => {
    const key = await mintKey("c1");
    const { status, body } = await upload(key, controlFile("a\x00b.pdf"));
    expect(status).toBe(201);
    expect(body.filename).toBe("ab.pdf");
    expect(body.filename).not.toContain("\x00");
  });

  it("rejects CRLF-like control chars in filename", async () => {
    const key = await mintKey("c2");
    const { status, body } = await upload(key, controlFile("a\r\nb.pdf"));
    expect(status).toBe(201);
    expect(body.filename).toBe("ab.pdf");
    expect(body.filename).not.toContain("\r");
    expect(body.filename).not.toContain("\n");
  });

  it("rejects DEL (\\x7F) and invisible (\\x01) control chars", async () => {
    const key = await mintKey("c3");
    const { status, body } = await upload(key, controlFile("\x01name\x7F.pdf"));
    expect(status).toBe(201);
    expect(body.filename).toBe("name.pdf");
  });

  it("sanitizes a combined path-traversal + control-char attack", async () => {
    const key = await mintKey("c4");
    const { status, body } = await upload(
      key,
      controlFile("../../etc/passwd\x00exploit.pdf"),
    );
    expect(status).toBe(201);
    expect(body.filename).toBe("passwdexploit.pdf");
    expect(body.filename).not.toContain("..");
    expect(body.filename).not.toContain("/");
    expect(body.filename).not.toContain("\x00");
  });
});
