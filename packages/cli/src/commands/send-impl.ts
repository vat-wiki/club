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
  /** Send the composed message (text + attachment ids) into `room`. */
  send: (content: string, attachmentIds?: string[], room?: string) => Promise<unknown>;
}

export interface SendInput {
  content: string; // already trimmed
  images: string[]; // raw paths
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
  const { content, images, conn } = input;

  if (!content && images.length === 0) {
    throw new Error("no message. pass text, use --stdin, or attach --image <path>");
  }

  // Fail fast on an over-long image list before any upload happens.
  assertImageCount(images);

  const attachmentIds: string[] = [];
  for (const p of images) {
    const att = await deps.uploadImage(conn, p);
    attachmentIds.push(att.id);
  }

  await deps.send(
    content,
    attachmentIds.length > 0 ? attachmentIds : undefined,
    input.room,
  );
  return { attachmentIds };
}
