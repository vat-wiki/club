import { createMiddleware } from "hono/factory";

import { randomUUID } from "node:crypto";

/**
 * Security response headers middleware.
 *
 * Adds standard defense-in-depth headers to every response:
 *   - Content-Security-Policy: restricts script/style/font origins; blocks framing.
 *   - Strict-Transport-Security: forces HTTPS on supporting clients.
 *   - X-Content-Type-Options: prevents MIME-type sniffing.
 *   - X-Frame-Options: legacy framing protection (backup for CSP frame-ancestors).
 *   - Referrer-Policy: limits referrer information leakage.
 *   - Permissions-Policy: disables unnecessary browser features including
 *     sensors (usb, serial, magnetometer, gyroscope, accelerometer) that a
 *     chat SPA never uses.
 *   - X-Permitted-Cross-Domain-Policies: none — blocks any Flash/SWF
 *     cross-domain access (legacy hardening).
 *   - X-Download-Options: noopen — prevents downloaded files from being
 *     executed inline in older IE/Edge.
 *   - X-Robots-Tag: noindex, nofollow, noarchive — keeps chat content out of
 *     search engines.
 *   - Cache-Control / Pragma / Vary: prevents caching of authenticated API
 *     responses by browsers, CDNs, and reverse proxies; varies on
 *     Authorization so unauthenticated error pages are cached separately.
 *   - X-Request-ID: per-request UUID for tracing/debugging in logs.
 *   - X-DNS-Prefetch-Control: disables speculative DNS lookups that leak intent.
 *   - Cross-Origin headers (CORP / COEP / COOP): isolate the web app from
 *     foreign origins, enabling Origin-Clean headers (cross-origin read
 *     blocking) and narrowing Spectre-style side-channel surface on the
 *     chat SPA's SSE/WebSocket data plane.
 *
 * Cache-Control: no-store, no-cache, must-revalidate is applied globally as a
 * safe default. Static assets served by serveStatic() (web app) and the
 * GET /files/:id route explicitly set their own Cache-Control later in the
 * pipeline, overriding this default for cacheable content.
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
      "style-src 'self'",
      "img-src 'self' data: blob:",
      "font-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
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
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), magnetometer=(), gyroscope=(), accelerometer=()",
  );
  c.header("X-Permitted-Cross-Domain-Policies", "none");
  c.header("X-Download-Options", "noopen");
  // Private chat app: prevent search-engine indexing and crawling of chat content.
  c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
  // Traceable per-request identifier for correlation across logs.
  c.header("X-Request-ID", randomUUID());
  // Disables speculative DNS prefetches that can leak navigation intent.
  c.header("X-DNS-Prefetch-Control", "off");
  // Cross-Origin isolation: CORP same-origin + COEP require-corp + COOP
  // same-origin-origin-when-cross-origin. Together they enable Origin-Clean
  // headers (read blocking for cross-origin fetch/XHR/XMLHttpRequest) and
  // reduce Spectre-style side-channel surface on the chat SPA's SSE/WebSocket
  // data plane, where user messages and mentions are streamed.
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  c.header("Cross-Origin-Embedder-Policy", "require-corp");
  c.header("Cross-Origin-Opener-Policy", "same-origin-origin-when-cross-origin");
  // Defensive cache control for API responses: prevent browsers, CDNs, and
  // reverse proxies from storing sensitive data (messages, mentions, participant
  // info, SSE frames). Static assets served by serveStatic() and
  // GET /files/:id override this later in the pipeline.
  c.header(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  );
  c.header("Pragma", "no-cache");
  // Cache unauthenticated 401 errors separately from authenticated responses
  // so reverse proxies don't serve stale error bodies to valid clients.
  c.header("Vary", "Authorization");
  await next();
});
