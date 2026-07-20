import { createHash } from "node:crypto";

/**
 * Compute a SHA-256 hex digest of a plaintext key for use as a DB lookup key.
 *
 * The raw bearer token is never stored; only this hash is persisted in the
 * `participants.key_hash` column. Callers (notably the `requireAuth` middleware
 * and `POST /participants` key issuance) pass the plaintext here so the hash
 * can be computed consistently end-to-end.
 *
 * SHA-256 is a one-way lookup optimisation — it is the index, not the
 * verification primitive. For new credentials the server also stores a salted
 * scrypt-derived value (`key_derived`) which is verified with a constant-time
 * comparison during authentication to defend against a leaked `key_hash`.
 *
 * @param plaintext - The raw bearer token to hash.
 * @returns Hex-encoded SHA-256 digest.
 */
export function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}