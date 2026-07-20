// Node-only image upload helper: read a file from disk, sniff its real mime
// from the magic bytes (not the filename extension — that's trivially forged),
// enforce the shared limits, then POST it via uploadFile(). Shared by the CLI
// and the MCP adapter so both agents and humans get identical pre-flight
// behavior, and so the logic is unit-tested in one place.
//
// The server remains the authoritative checker (it re-validates mime/size and
// probes dimensions before storing); this is a client-side pre-flight to avoid
// uploading bytes that are obviously doomed. image-size is the same library
// the server uses to probe dimensions, so the sniff can't drift from the
// server's notion of what a valid image is.

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import imageSize from "image-size";
import {
  ImageMime,
  VideoMime,
  DocumentMime,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGES_PER_MESSAGE,
  type MessageAttachment,
} from "@club/shared";
import { ClubApiError, NETWORK_ERROR_STATUS, formatError } from "./errors.js";
import { uploadFile, type ClubConn } from "./transport.js";

// image-size reports the format as the lowercased extension (e.g. "jpg", not
// "jpeg"); map it back to the MIME the server's ImageMime enum expects.
const TYPE_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

// Sniff a video's real container from its header bytes — image-size doesn't
// recognize video, so we read the magic bytes directly. Returns the VideoMime
// value, or undefined if the bytes aren't a browser-playable mp4/webm:
//   - MP4: an "ftyp" box at offset 4 (major brand mp42/isom/iso5/avc1/…). The
//     "qt" brand is QuickTime .mov, which browsers don't play natively → reject.
//   - WebM: the EBML/Matroska magic 0x1A 0x45 0xDF 0xA3.
function sniffVideoMime(buf: Buffer): string | undefined {
  if (buf.length >= 12 && buf.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = buf.subarray(8, 12).toString("latin1");
    if (brand.startsWith("qt")) return undefined; // .mov — not web-playable
    return "video/mp4";
  }
  if (
    buf.length >= 4 &&
    buf[0] === 0x1a &&
    buf[1] === 0x45 &&
    buf[2] === 0xdf &&
    buf[3] === 0xa3
  ) {
    return "video/webm";
  }
  return undefined;
}

export interface UploadFileOpts {
  timeoutMs?: number;
}

/**
 * Read an image from `path`, sniff & validate it, then upload it via POST /files.
 * Throws ClubApiError on any pre-flight failure (missing file, not an image,
 * wrong type, too large) so callers can surface a single uniform error path.
 */
export async function uploadImageFile(
  conn: ClubConn,
  path: string,
  opts: UploadFileOpts = {},
): Promise<MessageAttachment> {
  let buf: Buffer;
  try {
    buf = await readFile(path);
  } catch (err) {
    // ENOENT / EACCES etc. — the underlying message already names the path.
    throw new ClubApiError(`could not read ${path}: ${formatError(err)}`, NETWORK_ERROR_STATUS);
  }

  if (buf.byteLength > MAX_IMAGE_BYTES) {
    throw new ClubApiError(
      `${path} is ${buf.byteLength} bytes; max is ${MAX_IMAGE_BYTES}`,
      413,
    );
  }

  // Sniff the actual format from the header bytes. imageSize throws on
  // unrecognized input; a non-image file therefore surfaces as a clear "not an
  // image" rejection rather than an upload that the server would 415 anyway.
  let type: string | undefined;
  try {
    type = imageSize(buf).type;
  } catch {
    throw new ClubApiError(`${path} is not a recognized image`, 415);
  }

  const mime = type ? TYPE_TO_MIME[type] : undefined;
  if (!mime || !ImageMime.safeParse(mime).success) {
    throw new ClubApiError(
      `${path} has unsupported image type ${type ?? "unknown"} (allowed: png, jpeg, gif, webp)`,
      415,
    );
  }

  return uploadFile(conn, { buffer: buf, filename: basename(path), mime }, opts);
}

/**
 * Read a video from `path`, sniff & validate it, then upload it via POST /files.
 * Mirrors uploadImageFile but for the video formats (mp4/webm, 50MB): image-size
 * can't sniff video, so the container is read from the header magic bytes
 * (sniffVideoMime). Throws ClubApiError on any pre-flight failure. Videos get a
 * longer default upload window (180s) since they can be large.
 */
export async function uploadVideoFile(
  conn: ClubConn,
  path: string,
  opts: UploadFileOpts = {},
): Promise<MessageAttachment> {
  let buf: Buffer;
  try {
    buf = await readFile(path);
  } catch (err) {
    throw new ClubApiError(`could not read ${path}: ${formatError(err)}`, NETWORK_ERROR_STATUS);
  }

  if (buf.byteLength > MAX_VIDEO_BYTES) {
    throw new ClubApiError(
      `${path} is ${buf.byteLength} bytes; max is ${MAX_VIDEO_BYTES}`,
      413,
    );
  }

  const mime = sniffVideoMime(buf);
  if (!mime || !VideoMime.safeParse(mime).success) {
    throw new ClubApiError(
      `${path} is not a recognized video (allowed: mp4, webm)`,
      415,
    );
  }

  return uploadFile(
    conn,
    { buffer: buf, filename: basename(path), mime },
    { timeoutMs: opts.timeoutMs ?? 180_000 },
  );
}

// Map a document's filename extension to its MIME. Documents can't be sniffed
// from a stable magic prefix the way images (image-size) and videos (ftyp/EBML)
// can — PDF starts with %PDF but .docx/.xlsx are ZIP containers and .md is plain
// text — so we trust the extension. The server re-validates the MIME anyway, so
// a wrong guess is rejected authoritatively rather than stored mislabeled.
const EXT_TO_DOC_MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  md: "text/markdown",
  markdown: "text/markdown",
};

/**
 * Read a document from `path`, infer its MIME from the extension, validate it,
 * then upload via POST /files. Throws ClubApiError on any pre-flight failure
 * (missing file, unsupported type, too large). Mirrors uploadImageFile /
 * uploadVideoFile.
 */
export async function uploadDocumentFile(
  conn: ClubConn,
  path: string,
  opts: UploadFileOpts = {},
): Promise<MessageAttachment> {
  let buf: Buffer;
  try {
    buf = await readFile(path);
  } catch (err) {
    throw new ClubApiError(`could not read ${path}: ${formatError(err)}`, NETWORK_ERROR_STATUS);
  }

  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const mime = EXT_TO_DOC_MIME[ext];
  if (!mime || !DocumentMime.safeParse(mime).success) {
    throw new ClubApiError(
      `${path} has unsupported document type .${ext || "?"} (allowed: pdf, docx, xlsx, md)`,
      415,
    );
  }

  if (buf.byteLength > MAX_DOCUMENT_BYTES) {
    throw new ClubApiError(
      `${path} is ${buf.byteLength} bytes; max is ${MAX_DOCUMENT_BYTES}`,
      413,
    );
  }

  return uploadFile(conn, { buffer: buf, filename: basename(path), mime }, opts);
}

/**
 * Validate that a list of attachment paths is within the per-message quota
 * before any upload starts, so the user fails fast on "too many" instead of
 * after uploading several. The cap (MAX_IMAGES_PER_MESSAGE) is a shared budget
 * for images AND videos combined — pass the total count. Returns void; throws
 * ClubApiError(400) on overflow.
 */
export function assertAttachmentCount(paths: readonly string[]): void {
  if (paths.length > MAX_IMAGES_PER_MESSAGE) {
    throw new ClubApiError(
      `too many attachments: ${paths.length} (max ${MAX_IMAGES_PER_MESSAGE} per message)`,
      400,
    );
  }
}
