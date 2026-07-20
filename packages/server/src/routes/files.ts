import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { imageSize } from "image-size";
import {
  AttachmentMime,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MAX_DOCUMENT_BYTES,
  type MessageAttachment,
} from "@club/shared";
import { requireAuth } from "../auth.js";
import { insertFile, getFile } from "../db.js";
import { jsonErr } from "../lib.js";
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
    return jsonErr(c, "expected multipart form data");
  }

  const file = body.file;
  if (!(file instanceof File)) {
    return jsonErr(c, 'missing "file" field');
  }

  const size = file.size;
  if (size <= 0) {
    return jsonErr(c, "empty file");
  }

  const me = c.get("participant");

  // Authoritative mime check: the server is the sole source of truth, so a
  // client can't smuggle in an unsupported file under a forged label. One parse
  // against AttachmentMime (image ∪ video) yields a fully-narrowed mime; we then
  // branch on it to pick the size cap and whether to probe dimensions.
  const parsed = AttachmentMime.safeParse(file.type);
  if (!parsed.success) {
    return jsonErr(c, "unsupported file type", 415);
  }
  const mime = parsed.data; // ImageMime | VideoMime | DocumentMime
  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  // Anything that passed AttachmentMime but isn't image/video is a document.
  const isDocument = !isImage && !isVideo;
  const maxBytes = isVideo
    ? MAX_VIDEO_BYTES
    : isDocument
      ? MAX_DOCUMENT_BYTES
      : MAX_IMAGE_BYTES;

  if (size > maxBytes) {
    const kind = isVideo ? "video" : isDocument ? "document" : "image";
    return jsonErr(
      c,
      `${kind} must be at most ${maxBytes} bytes (got ${size})`,
      413,
    );
  }

  // Original filename (display metadata only — the blob is stored under a
  // random id). Defensive pipeline:
  //   1. Keep only the basename (strip any path component).
  //   2. Remove ASCII control characters (\x00–\x1F, \x7F) — these can break
  //      downstream JSON parsing, HTML rendering, or trigger CRLF-style
  //      injection in debug/audit logs.
  //   3. Cap length to avoid unbounded BLOB growth.
  const filename =
    typeof file.name === "string" && file.name.trim().length > 0
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- split() always returns a non-empty array for a non-empty string; the guard above guarantees we have one
      ? file.name.split(/[\/\\]/).pop()!.replace(/[\x00-\x1F\x7F]/g, "").slice(0, 200)
      : null;

  // Read once into a buffer. For video/document this can reach tens of MB —
  // acceptable for club's single-room, low-concurrency profile. The write below
  // is async by design to avoid blocking the event loop on disk I/O.
  const buf = Buffer.from(await file.arrayBuffer());

  // Only images get dimension-probed (via image-size); video + document bytes
  // are stored verbatim (the <video> element reads its own size; documents
  // don't carry preview-useful dimensions server-side).
  let width: number | undefined;
  let height: number | undefined;
  if (isImage) {
    try {
      const dim = imageSize(buf);
      width = typeof dim.width === "number" ? dim.width : undefined;
      height = typeof dim.height === "number" ? dim.height : undefined;
    } catch {
      // Malformed image header — reject rather than store something clients
      // can't render.
      return jsonErr(c, "could not read image dimensions", 422);
    }
  }

  // Ensure the blob dir exists lazily on first upload rather than at boot, so
  // the server starts even if the volume isn't writable yet.
  const id = randomBytes(16).toString("base64url");
  const dir = filesDir();
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(filePath(id), buf);

  const createdAt = Date.now();
  insertFile({
    id,
    participant_id: me.id,
    mime,
    width: width ?? null,
    height: height ?? null,
    size,
    created_at: createdAt,
    filename,
  });

  const attachment: MessageAttachment = {
    id,
    url: `/files/${id}`,
    mime,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    size,
    ...(filename ? { filename } : {}),
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
  if (!row) return jsonErr(c, "not found", 404);

  const path = filePath(id);
  if (!existsSync(path)) return jsonErr(c, "not found", 404);

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
        Readable.toWeb(rangedStream),
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
    Readable.toWeb(nodeStream),
    200,
  );
});
