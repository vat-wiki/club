/**
 * Extract a bearer token from an Authorization header value.
 *
 * Accepts "Bearer <token>" case-insensitively, tolerates extra/leading spaces,
 * trims the token, and returns undefined for anything that isn't a Bearer
 * scheme (missing/empty header, "Basic ...", "Bearer" with no token).
 * Pure and safe to import anywhere (browser + Node).
 */
export function parseBearer(auth: string | undefined): string | undefined {
  if (!auth) return undefined;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : undefined;
}
