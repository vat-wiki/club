// The upload+send orchestration of `club send`, extracted as a pure-ish
// function so it can be unit-tested without spinning up a commander program or
// a real server. The commander action in send.ts is a thin wrapper that reads
// stdin/argv, calls this, and maps the outcome to process.exit / console.error.
//
// Injecting `uploadImage` and `send` (rather than constructing a ClubClient in
// here) keeps this module dependent only on shape — the test fakes them; the
// action wires the real SDK functions.

import { assertImageCount, type ClubConn } from "@club/sdk/node";

export interface SendDeps {
  /** Upload one local image path → attachment id. Throws on any pre-flight failure. */
  uploadImage: (conn: ClubConn, path: string) => Promise<{ id: string }>;
  /** Upload one local video path → attachment id. Throws on any pre-flight failure. */
  uploadVideo: (conn: ClubConn, path: string) => Promise<{ id: string }>;
  /** Send the composed message (text + attachment ids). */
  send: (content: string, attachmentIds?: string[]) => Promise<unknown>;
}

export interface SendInput {
  content: string; // already trimmed
  images: string[]; // raw image paths
  videos?: string[]; // raw video paths (optional; image-only callers omit it)
  conn: ClubConn;
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
  // Both lists are optional at the call site (a video-only send omits images
  // and vice-versa); default each so the combined cap + loops below are safe.
  const images = input.images ?? [];
  const videos = input.videos ?? [];

  if (!content && images.length === 0 && videos.length === 0) {
    throw new Error("no message. pass text, use --stdin, or attach --image/--video <path>");
  }

  // Fail fast on an over-long attachment list before any upload happens.
  // Images + videos share one per-message cap, so check the combined count.
  assertImageCount([...images, ...videos]);

  const attachmentIds: string[] = [];
  for (const p of images) {
    const att = await deps.uploadImage(conn, p);
    attachmentIds.push(att.id);
  }
  for (const p of videos) {
    const att = await deps.uploadVideo(conn, p);
    attachmentIds.push(att.id);
  }

  await deps.send(content, attachmentIds.length > 0 ? attachmentIds : undefined);
  return { attachmentIds };
}
