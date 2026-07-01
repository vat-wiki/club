import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { imageSize } from "image-size";
import {
  ImageMime,
  MAX_IMAGE_BYTES,
  type MessageAttachment,
} from "@club/shared";
import { requireAuth } from "../auth.js";
import { insertFile, getFile } from "../db.js";
import { filesDir, filePath } from "../files-dir.js";

export const files = new Hono();

// All mutations (upload) require auth; GET /files/:id is intentionally open
// (see plan §3): <img src> can't carry a bearer header, and club's single room
// is already visible to every member — an unguessable id is sufficient.
files.post("/", requireAuth, async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody();
  } catch {
    return c.json({ error: "expected multipart form data" }, 400);
  }

  const file = body.file;
  if (!(file instanceof File)) {
    return c.json({ error: 'missing "file" field' }, 400);
  }

  const size = file.size;
  if (size <= 0) {
    return c.json({ error: "empty file" }, 400);
  }
  if (size > MAX_IMAGE_BYTES) {
    return c.json(
      { error: `image must be at most ${MAX_IMAGE_BYTES} bytes (got ${size})` },
      413,
    );
  }

  // Authoritative mime check: the server is the sole source of truth for mime
  // (and width/height/size), so a client can't smuggle in a non-image file
  // under an image label. We validate against the shared ImageMime enum so FE
  // pre-flight checks and this route can never drift.
  const mimeParse = ImageMime.safeParse(file.type);
  if (!mimeParse.success) {
    return c.json({ error: "unsupported image type" }, 415);
  }
  const mime = mimeParse.data;

  // Read once: write to disk + probe dimensions from the same buffer. Probing
  // from the buffer (rather than the stream) is simplest and the data is small
  // (≤10MB).
  const buf = Buffer.from(await file.arrayBuffer());
  let width: number | undefined;
  let height: number | undefined;
  try {
    const dim = imageSize(buf);
    width = typeof dim.width === "number" ? dim.width : undefined;
    height = typeof dim.height === "number" ? dim.height : undefined;
  } catch {
    // Malformed image header — reject rather than store something clients can't
    // render.
    return c.json({ error: "could not read image dimensions" }, 422);
  }

  const me = c.get("participant");
  const id = randomBytes(16).toString("base64url");

  // Ensure the blob dir exists lazily on first upload rather than at boot, so
  // the server starts even if the volume isn't writable yet.
  const dir = filesDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath(id), buf);

  const createdAt = Date.now();
  insertFile({
    id,
    participant_id: me.id,
    mime,
    width: width ?? null,
    height: height ?? null,
    size,
    created_at: createdAt,
  });

  const attachment: MessageAttachment = {
    id,
    url: `/files/${id}`,
    mime,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    size,
  };
  return c.json(attachment, 201);
});

// GET /files/:id — stream the blob. No auth (plan §3). Immutable: the id is
// random and never reused, so we cache aggressively.
files.get("/:id", (c) => {
  const id = c.req.param("id");
  const row = getFile(id);
  if (!row) return c.json({ error: "not found" }, 404);

  const path = filePath(id);
  if (!existsSync(path)) return c.json({ error: "not found" }, 404);

  const stat = statSync(path);
  c.header("Content-Type", row.mime);
  c.header("Content-Length", String(stat.size));
  c.header("Cache-Control", "public, immutable, max-age=31536000");

  // Stream from disk rather than buffering the whole file into memory. Convert
  // the Node readable to a Web ReadableStream so Hono's node-server pipes it
  // straight through to the socket.
  const nodeStream = createReadStream(path);
  return c.body(
    Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>,
    200,
  );
});
