import { createMiddleware } from "hono/factory";

// Default maximum request body size. Uploads (multipart) are handled by the
// files route with a much higher per-kind cap, but JSON routes that accept
// message content, reactions, room creation, etc. are all bounded by this.
// 5 MB is large enough for any realistic JSON payload while capping a
// request-body DoS where an attacker feeds a multi-hundred-MB body that
// forces the server to buffer it into memory before the route handler runs.
export const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;

/**
 * Build a middleware that rejects requests whose Content-Length exceeds the
 * configured limit, returning a 413 with a `Content-Length` header describing
 * the cap.
 *
 * Checked at the earliest point in the pipeline (before body parsing / route
 * handlers) so memory is never consumed for oversized requests. Requests that
 * omit Content-Length (chunked encoding, or test harnesses that omit the
 * header) are allowed through — the downstream parser / route handler decides
 * what to do with them.
 *
 * @param maxBytes - Maximum allowed Content-Length in bytes.
 */
export function bodySizeGuard(maxBytes = DEFAULT_MAX_BODY_BYTES) {
  return createMiddleware(async (c, next) => {
    const header = c.req.header("content-length");
    if (header === null) {
      await next();
      return;
    }
    const len = Number(header);
    if (!Number.isFinite(len) || len < 0 || len > maxBytes) {
      c.header("Content-Length", "0");
      return c.json(
        { error: `request body exceeds ${maxBytes} bytes limit` },
        413,
      );
    }
    await next();
  });
}
