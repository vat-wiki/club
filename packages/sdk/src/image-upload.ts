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
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_MESSAGE,
  type MessageAttachment,
} from "@club/shared";
import { ClubApiError } from "./errors.js";
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

export interface UploadImageOpts {
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
  opts: UploadImageOpts = {},
): Promise<MessageAttachment> {
  let buf: Buffer;
  try {
    buf = await readFile(path);
  } catch (err) {
    // ENOENT / EACCES etc. — the underlying message already names the path.
    throw new ClubApiError(`could not read ${path}: ${(err as Error).message}`, 0);
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
 * Validate that a list of image paths is within the per-message quota before
 * any upload starts, so the user fails fast on "too many" instead of after
 * uploading several. Returns void; throws ClubApiError(400) on overflow.
 */
export function assertImageCount(paths: readonly string[]): void {
  if (paths.length > MAX_IMAGES_PER_MESSAGE) {
    throw new ClubApiError(
      `too many images: ${paths.length} (max ${MAX_IMAGES_PER_MESSAGE} per message)`,
      400,
    );
  }
}
