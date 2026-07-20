import { resolve } from "node:path";
import { realpath as realpathNative } from "node:fs/promises";

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

/**
 * Absolute path on disk for a stored file id, with defense-in-depth against
 * path traversal and symlink-based escapes.
 *
 * 1. Rejects ids containing path separators or `..` (defense-in-depth for
 *    future callers that might pass DB-derived ids).
 * 2. `resolve()` normalizes the path; `startsWith(dir)` catches any that
 *    escape the files directory.
 * 3. **Symlink guard**: `realpath.native()` follows any symlinks in the path
 *    chain and checks that the final on-disk location is still inside the
 *    files dir. If a malicious file (or an attacker-placed symlink) points
 *    outside, the real path will not start with the dir prefix, and we
 *    silently fall back so the caller 404s.
 *
 * Uses `realpath.native()` (not `realpath`) so Windows short/long-name
 * resolution does not munge the comparison; only the physical symlink chain
 * is followed.
 *
 * @param id - The base64url file id. Must contain no path separators or
 *   traversal tokens for valid ids.
 * @returns Absolute path to the file; callers must still handle `ENOENT`
 *   and treat missing files as 404.
 */
export async function filePath(id: string): Promise<string> {
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
  // Symlink guard: resolve the real on-disk path and verify it is still
  // inside the files directory. If `realpath` fails (file doesn't exist yet),
  // fall back to the logical path — the caller will 404 anyway.
  try {
    const real = await realpathNative(joined);
    if (!real.startsWith(dir)) {
      // Symlink points outside the files directory → escape attempt.
      return resolve(process.cwd(), "files");
    }
    return real;
  } catch {
    // File or symlink doesn't exist on disk yet (e.g. during upload
    // write-before-read paths). Return the logical path; security is still
    // enforced at the write boundary (upload route creates the file, and
    // read paths will 404 here).
    return joined;
  }
}
