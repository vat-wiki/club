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
  type ImageMime,
  type VideoMime,
  type DocumentMime,
  type MessageAttachment,
} from "@club/shared";
import { requireAuth } from "../auth.js";
import { insertFile, getFile } from "../db.js";
import { jsonErr } from "../lib.js";
import { filesDir, filePath } from "../files-dir.js";

/**
 * Build a safe `Content-Disposition: attachment` header value from the
 * original upload filename. Strips path separators, control characters,
 * and caps length so the header is well-formed and predictable.
 *
 * Uses RFC 5987 `filename*=UTF-8''...` for non-ASCII filenames so that
 * browsers (and proxies) always recover the correct bytes.
 *
 * @param filename - Optional original upload filename. Returns null if
 *   blank, and callers should simply omit the header in that case.
 */
export function contentDispositionFilename(
  filename: string | null | undefined,
): string | null {
  if (filename == null || filename.trim() === "") return null;
  // Defensive: keep only the basename and strip ASCII control chars
  // (\x00–\x1F, \x7F) — these can break downstream parsing or trigger
  // CRLF-style injection in debug/audit logs.
  const cleaned = filename
    .split(/[\/\\]/)
    .pop()
    ?.replace(/[\x00-\x1F\x7F]/g, "")
    ?.slice(0, 200) ?? "";
  if (cleaned.trim() === "") return null;
  // RFC 5987: filename*=UTF-8''<percent-encoded>
  const utf8Encoded = encodeURIComponent(cleaned)
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
  // ASCII fallback in quotes for legacy clients
  const asciiSafe = cleaned.replace(/[\\"]/g, (m) => "\\" + m);
  return `attachment; filename="${asciiSafe}"; filename*=UTF-8''${utf8Encoded}`;
}

// ── Magic-bytes MIME detection ──────────────────────────────────────
//
// File content is identified by a signature at the start of the file
// ("magic bytes"), independent of the client-supplied `file.type` which
// is trivially forgeable. We read the first few bytes of the buffer and
// verify the content kind matches the claimed MIME kind. Returns `null`
// on mismatch or when the content has no recognized signature.
//
// Supported signatures (all read from the start of the buffer):
//   PNG:    0x89 50 4E 47 0D 0A 1A 0A
//   JPEG:   0xFF 0xD8 0xFF
//   GIF:    0x47 49 46 38 37 61  or  0x47 49 46 38 39 61  ("GIF87a"/"GIF89a")
//   WebP:   0x52 59 56 46 ("RIFF") + "WEBP" at offset 8
//   MP4:    "ftyp" at offset 4 (ISO Base Media file format)
//   WebM:   EBML header: 0x1A 45 DF A3
//   PDF:    "%PDF" at offset 0
//
// ZIP-family documents (.docx, .xlsx, .odt, .ods) share the PK\x03\x04
// local-file-header signature, so magic bytes cannot distinguish them.
// Those are accepted as any claimed `application/...` document MIME
// except `text/markdown` (a markdown file should never start with a ZIP
// header). Plain .md has no magic signature and is accepted on the
// schema-parsed MIME only.

const SIGNATURES: Array<{
  kind: "image" | "video" | "document";
  match(buf: Buffer): boolean;
}> = [
  { kind: "image", match: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }, // PNG
  { kind: "image", match: (b) => startsWith(b, [0xff, 0xd8, 0xff]) }, // JPEG
  { kind: "image", match: (b) => startsWith(b, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(b, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) }, // GIF
  { kind: "image", match: (b) => b.length > 12 && startsWith(b, [0x52, 0x59, 0x56, 0x46]) && b.subarray(8, 12).toString("ascii") === "WEBP" }, // WebP
  { kind: "video", match: (b) => b.length > 12 && b.subarray(4, 8).toString("ascii") === "ftyp" }, // MP4 / ftyp ISO base media
  { kind: "video", match: (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]) }, // WebM / Matroska EBML
  { kind: "document", match: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46]) }, // PDF
];

function startsWith(buf: Buffer, signature: number[]): boolean {
  if (buf.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (buf[i] !== signature[i]) return false;
  }
  return true;
}

function looksLikeZip(buf: Buffer): boolean {
  return startsWith(buf, [0x50, 0x4b, 0x03, 0x04]);
}

/**
 * Verify the file's magic bytes agree with the client-claimed MIME.
 *
 * @param buf - Uploaded file content.
 * @param claimedMime - MIME parsed from the client-supplied `file.type`.
 * @returns `claimedMime` if the content kind matches, `null` to reject.
 */
export function detectAndVerifyMime(
  buf: Buffer,
  claimedMime: ImageMime | VideoMime | DocumentMime,
): ImageMime | VideoMime | DocumentMime | null {
  if (buf.length < 2) return null;
  for (const sig of SIGNATURES) {
    if (sig.match(buf)) {
      // Match found: verify the claimed kind agrees with the detected kind.
      // "document" kind maps to "application/..."-prefixed MIMEs;
      // image/video use the literal kind prefix.
      const kindPrefix =
        sig.kind === "document" ? "application/" : `${sig.kind}/`;
      if (claimedMime.startsWith(kindPrefix)) return claimedMime;
      return null; // kind mismatch → reject
    }
  }
  // ZIP-family: accept any claimed application/... document MIME except
  // text/markdown (which should never be a ZIP).
  if (looksLikeZip(buf)) {
    if (claimedMime === "text/markdown") return null;
    return claimedMime;
  }
  // No recognized signature → reject unknown content.
  return null;
}

// ── Route ───────────────────────────────────────────────────────────

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

  // Parse the client-supplied MIME first so we can apply the right size cap
  // before buffering the full body. Validates only that the label is an
  // accepted type; the magic-bytes step below verifies the content matches.
  const parsed = AttachmentMime.safeParse(file.type);
  if (!parsed.success) {
    return jsonErr(c, "unsupported file type", 415);
  }
  const claimed = parsed.data;
  const maxBytes = claimed.startsWith("video/")
    ? MAX_VIDEO_BYTES
    : claimed.startsWith("image/")
      ? MAX_IMAGE_BYTES
      : MAX_DOCUMENT_BYTES;

  if (size > maxBytes) {
    const kind = claimed.startsWith("video/")
      ? "video"
      : claimed.startsWith("image/")
        ? "image"
        : "document";
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

  // Magic-bytes verification: reject if the file's actual content (its magic
  // bytes) indicates a different MIME kind than the client claimed. A
  // forged `file.type` is trivial; magic bytes are not — this closes the
  // MIME-confusion attack surface where e.g. a script could be served as a
  // PNG by an image consumer.
  // (image-size below provides an additional image-validity check.)
  const verified = detectAndVerifyMime(buf, claimed);
  if (!verified) {
    return jsonErr(c, "file content does not match declared type", 415);
  }
  const mime: ImageMime | VideoMime | DocumentMime = verified;
  const isImage = mime.startsWith("image/");

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
  await writeFile(await filePath(id), buf);

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
files.get("/:id", async (c) => {
  const id = c.req.param("id");
  const row = getFile(id);
  if (!row) return jsonErr(c, "not found", 404);

  const path = await filePath(id);
  if (!existsSync(path)) return jsonErr(c, "not found", 404);

  const stat = statSync(path);
  const total = stat.size;
  c.header("Content-Type", row.mime);
  c.header("Accept-Ranges", "bytes");
  c.header("Cache-Control", "public, immutable, max-age=31536000");
  // Restore the original upload filename in Content-Disposition so
  // "Save As…" uses a human-readable name rather than the random id.
  // Skipped when no filename was stored (upload predates this field).
  const disposition = contentDispositionFilename(row.filename ?? null);
  if (disposition) c.header("Content-Disposition", disposition);

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
