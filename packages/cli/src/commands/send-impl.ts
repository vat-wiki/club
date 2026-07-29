// The upload+send orchestration of `club send`, extracted as a pure-ish
// function so it can be unit-tested without spinning up a commander program or
// a real server. The commander action in send.ts is a thin wrapper that reads
// stdin/argv, calls this, and maps the outcome to process.exit / console.error.
//
// Injecting `uploadImage` and `send` (rather than constructing a ClubClient in
// here) keeps this module dependent only on shape — the test fakes them; the
// action wires the real SDK functions.

import { assertAttachmentCount, type ClubConn } from "@club/sdk/node";
import { type Message } from "@club/shared";

export interface SendDeps {
  /** Upload one local image path → attachment id. Throws on any pre-flight failure. */
  uploadImage: (conn: ClubConn, path: string) => Promise<{ id: string }>;
  /** Upload one local video path → attachment id. Throws on any pre-flight failure. */
  uploadVideo: (conn: ClubConn, path: string) => Promise<{ id: string }>;
  /** Upload one local document path → attachment id. Throws on any pre-flight failure. */
  uploadDocument: (conn: ClubConn, path: string) => Promise<{ id: string }>;
  /** Send the composed message (text + attachment ids) into `room`. */
  send: (content: string, attachmentIds?: string[], room?: string) => Promise<Message>;
}

export interface SendInput {
  content: string; // already trimmed
  images: string[]; // raw image paths
  videos?: string[]; // raw video paths (optional; image-only callers omit it)
  documents?: string[]; // raw document paths (pdf/docx/xlsx/md)
  conn: ClubConn;
  /** Room to post into; resolved by the caller (flag → config default → general). */
  room?: string;
}

export interface SendResult {
  attachmentIds: string[]; // ids actually uploaded ([] when no images)
}

/**
 * Validate + upload images (if any) and send the message. Throws on any
 * client-side failure (missing file, bad type, oversize, too many, network);
 * the caller decides how to surface it. Returns the uploaded attachment ids so
 * a caller can log them.
 */
export async function runSend(
  input: SendInput,
  deps: SendDeps,
): Promise<SendResult> {
  const { content, conn } = input;
  // Each list is optional at the call site (a video-only send omits images,
  // etc.); default each so the combined cap + loops below are safe.
  const images = input.images ?? [];
  const videos = input.videos ?? [];
  const documents = input.documents ?? [];

  if (!content && images.length === 0 && videos.length === 0 && documents.length === 0) {
    throw new Error("no message. pass text, use --stdin, or attach --image/--video/--file <path>");
  }

  // Fail fast on an over-long attachment list before any upload happens.
  // Images, videos, and documents all share one per-message cap.
  assertAttachmentCount([...images, ...videos, ...documents]);

  // Unified upload loop: each attachment "type" is a typed list paired with the
  // uploader that handles it. Adding a new type only requires appending an entry
  // to this array rather than duplicating the loop body below.
  const batches: Array<{
    paths: string[];
    upload: (conn: ClubConn, path: string) => Promise<{ id: string }>;
  }> = [
    { paths: images, upload: deps.uploadImage },
    { paths: videos, upload: deps.uploadVideo },
    { paths: documents, upload: deps.uploadDocument },
  ];

  const attachmentIds = await uploadAll(conn, batches);

  await deps.send(
    content,
    attachmentIds.length > 0 ? attachmentIds : undefined,
    input.room,
  );
  return { attachmentIds };
}

/** Upload every path in each batch via its paired uploader, in order.
 *  Errors (missing file, bad type, oversize, network) propagate straight to the
 *  caller; partial uploads can leave uploaded ids still valid — callers decide
 *  whether to retry or surface the error.
 *
 *  Separated from runSend so the per-type upload loop lives in one place and
 *  new attachment types are a one-line addition to runSend's batches array.
 */
async function uploadAll(
  conn: ClubConn,
  batches: Array<{
    paths: string[];
    upload: (conn: ClubConn, path: string) => Promise<{ id: string }>;
  }>,
): Promise<string[]> {
  const ids: string[] = [];
  for (const { paths, upload } of batches) {
    for (const p of paths) {
      ids.push((await upload(conn, p)).id);
    }
  }
  return ids;
}
