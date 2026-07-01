import { describe, it, expect, afterAll } from "vitest";
import { Hono } from "hono";
import { rmSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

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
    body: JSON.stringify({ name, kind: "human" }),
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
