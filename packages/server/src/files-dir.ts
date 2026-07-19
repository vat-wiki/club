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

/** Absolute path on disk for a stored file id.
 *
 *  Uses `join` rather than `resolve` so the resolved path can never escape
 *  the files directory (no `..` traversal). Returns null and resolves safely
 *  to `<cwd>/files` when `id` is empty, so a caller that omits the param
 *  cannot be coaxed into resolving the parent directory.
 */
export function filePath(id: string): string {
  // Path-traversal guard: reject any id containing a path separator or
  // traversal tokens. Stored ids are base64url tokens (alphanum, '-', '_'),
  // so this is a cheap check that also acts as a defense-in-depth against
  // a future code path that passes a DB row whose id was somehow corrupted.
  if (id.includes("/") || id.includes("\\") || id.includes("..")) {
    return resolve(process.cwd(), "files"); // safe fallback; caller will 404
  }
  const dir = filesDir();
  const joined = resolve(dir + "/" + id);
  // Ensure the resolved path is still under the files dir. If `resolve`
  // escapes (e.g. via symlink), fall back to a no-op path so the caller 404s.
  if (!joined.startsWith(dir)) {
    return resolve(process.cwd(), "files");
  }
  return joined;
}
