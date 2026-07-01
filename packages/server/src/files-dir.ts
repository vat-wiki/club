import { resolve } from "node:path";

/**
 * Directory where uploaded images are written to disk.
 *
 * Defaults to `<cwd>/files`; overridable via `CLUB_FILES` for deployments that
 * want the blob store on a different volume. This is the single seam meant to
 * be swapped when (Phase B/P2) we move blobs to object storage — only this
 * function and its caller should know where bytes physically live.
 */
export function filesDir(): string {
  return process.env.CLUB_FILES ?? resolve(process.cwd(), "files");
}

/** Absolute path on disk for a stored file id. */
export function filePath(id: string): string {
  return resolve(filesDir(), id);
}
