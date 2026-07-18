import { createMiddleware } from "hono/factory";

/**
 * Security response headers middleware.
 *
 * Adds standard defense-in-depth headers to every response:
 *   - Content-Security-Policy: restricts script/style/font origins; blocks framing.
 *   - Strict-Transport-Security: forces HTTPS on supporting clients.
 *   - X-Content-Type-Options: prevents MIME-type sniffing.
 *   - X-Frame-Options: legacy framing protection (backup for CSP frame-ancestors).
 *   - Referrer-Policy: limits referrer information leakage.
 *   - Permissions-Policy: disables unnecessary browser features.
 *
 * All header values are safe defaults for a chat SPA served at the same origin
 * as the API. In a production deployment behind a reverse proxy that also
 * terminates TLS, HSTS and the security headers still help when clients access
 * the origin directly.
 */
export const securityHeaders = createMiddleware(async (c, next) => {
  c.header(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ].join("; "),
  );
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  await next();
});
