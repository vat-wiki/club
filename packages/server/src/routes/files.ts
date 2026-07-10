import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { imageSize } from "image-size";
import {
  AttachmentMime,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
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

  const me = c.get("participant");

  // Authoritative mime check: the server is the sole source of truth, so a
  // client can't smuggle in an unsupported file under a forged label. One parse
  // against AttachmentMime (image ∪ video) yields a fully-narrowed mime; we then
  // branch on it to pick the size cap and whether to probe dimensions.
  const parsed = AttachmentMime.safeParse(file.type);
  if (!parsed.success) {
    return c.json({ error: "unsupported file type" }, 415);
  }
  const mime = parsed.data; // ImageMime | VideoMime
  const isVideo = mime.startsWith("video/");
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;

  if (size > maxBytes) {
    const kind = isVideo ? "video" : "image";
    return c.json(
      { error: `${kind} must be at most ${maxBytes} bytes (got ${size})` },
      413,
    );
  }

  // Read once into a buffer. For video this can reach MAX_VIDEO_BYTES (50MB) —
  // acceptable for club's single-room, low-concurrency profile; a future
  // streaming write would slot in at the files-dir.ts seam if that grows.
  const buf = Buffer.from(await file.arrayBuffer());

  let width: number | undefined;
  let height: number | undefined;
  if (!isVideo) {
    try {
      const dim = imageSize(buf);
      width = typeof dim.width === "number" ? dim.width : undefined;
      height = typeof dim.height === "number" ? dim.height : undefined;
    } catch {
      // Malformed image header — reject rather than store something clients
      // can't render.
      return c.json({ error: "could not read image dimensions" }, 422);
    }
  }

  // Ensure the blob dir exists lazily on first upload rather than at boot, so
  // the server starts even if the volume isn't writable yet.
  const id = randomBytes(16).toString("base64url");
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
// random and never reused, so we cache aggressively. Supports HTTP Range
// requests (206 Partial Content) so a <video> can seek/scrub; images ignore it
// and get the full body. Accept-Ranges is advertised unconditionally.
files.get("/:id", (c) => {
  const id = c.req.param("id");
  const row = getFile(id);
  if (!row) return c.json({ error: "not found" }, 404);

  const path = filePath(id);
  if (!existsSync(path)) return c.json({ error: "not found" }, 404);

  const stat = statSync(path);
  const total = stat.size;
  c.header("Content-Type", row.mime);
  c.header("Accept-Ranges", "bytes");
  c.header("Cache-Control", "public, immutable, max-age=31536000");

  const range = c.req.header("range");
  if (range) {
    // Parse a single byte range: "bytes=start-end", "bytes=start-", or suffix
    // "bytes=-N" (last N bytes). A malformed header falls through to a full 200
    // rather than erroring — matches how most static servers tolerate it.
    const m = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
    if (m) {
      const totalEnd = total - 1;
      let start: number;
      let end: number;
      if (m[1] === "") {
        // Suffix range → last N bytes.
        const suffix = m[2] === "" ? total : parseInt(m[2], 10);
        start = Math.max(0, total - suffix);
        end = totalEnd;
      } else {
        start = parseInt(m[1], 10);
        end = m[2] === "" ? totalEnd : Math.min(parseInt(m[2], 10), totalEnd);
      }
      if (
        Number.isNaN(start) ||
        Number.isNaN(end) ||
        start >= total ||
        start > end
      ) {
        // Unsatisfiable → 416 with a Content-Range naming the real size.
        c.header("Content-Range", `bytes */${total}`);
        return c.body(null, 416);
      }
      const length = end - start + 1;
      c.header("Content-Range", `bytes ${start}-${end}/${total}`);
      c.header("Content-Length", String(length));
      // createReadStream's end is inclusive — exactly what Content-Range describes.
      const rangedStream = createReadStream(path, { start, end });
      return c.body(
        Readable.toWeb(rangedStream) as unknown as ReadableStream<Uint8Array>,
        206,
      );
    }
  }

  // Stream from disk rather than buffering the whole file into memory. Convert
  // the Node readable to a Web ReadableStream so Hono's node-server pipes it
  // straight through to the socket.
  c.header("Content-Length", String(total));
  const nodeStream = createReadStream(path);
  return c.body(
    Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>,
    200,
  );
});
