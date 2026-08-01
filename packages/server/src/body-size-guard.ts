import { createMiddleware } from "hono/factory";

// Default maximum request body size for non-multipart requests. Multipart
// form-data uploads use a higher cap (MULTIPART_MAX_BODY_BYTES) instead.
// JSON routes that accept message content, reactions, channel creation, etc.
// are all bounded by this 5 MB limit - large enough for any realistic JSON
// payload while capping a request-body DoS where an attacker feeds a
// multi-hundred-MB body that forces the server to buffer it into memory before
// the route handler runs.
export const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;

// Maximum request body size for multipart/form-data uploads. Intentionally
// higher than DEFAULT_MAX_BODY_BYTES so legitimate file uploads (video up to
// 50 MB per-kind cap enforced by the files route) pass through, while still
// providing an absolute ceiling that prevents an OOM DoS: without it, a
// multipart request with a multi-hundred-MB body would be fully buffered into
// memory by c.req.parseBody() before the files route ever checks the per-kind
// size cap.
export const MULTIPART_MAX_BODY_BYTES = 60 * 1024 * 1024;

/**
 * Build a middleware that rejects requests whose body exceeds the configured
 * limit, returning a 413 with a human-readable error message.
 *
 * Multipart/form-data requests are held to a higher cap
 * (MULTIPART_MAX_BODY_BYTES, 60 MB) rather than the default 5 MB, because the
 * files route allows per-kind uploads up to 50 MB (video). The 60 MB ceiling
 * is above the largest legitimate upload while still preventing unbounded
 * memory consumption.
 *
 * Fast-path: if a `Content-Length` header is present and finite, reject
 * immediately when the declared size exceeds the cap - no body bytes are read.
 * Slow-path: for chunked or otherwise unbounded transfers (no / bogus / negative
 * `Content-Length`), consume the request body stream in chunks until either the
 * limit is breached (413) or the stream ends naturally (pass-through).
 *
 * Checked at the earliest point in the pipeline (before body parsing / route
 * handlers) so memory is never consumed for oversized requests.
 *
 * @param maxBytes - Maximum allowed body size in bytes for non-multipart
 *   requests. Multipart requests always use MULTIPART_MAX_BODY_BYTES.
 */
export function bodySizeGuard(maxBytes = DEFAULT_MAX_BODY_BYTES) {
  return createMiddleware(async (c, next) => {
    // Multipart/form-data uploads use a higher cap (60 MB) instead of the
    // default 5 MB: the files route enforces a per-kind cap (video 50 MB /
    // document 25 MB / image 10 MB) far above this guard's default limit, so
    // enforcing 5 MB here would reject legitimate large uploads before they
    // ever reach the files handler. The 60 MB ceiling still prevents an OOM
    // DoS where a multipart body is buffered entirely into memory before the
    // per-kind check runs. The content type arrives as
    // "multipart/form-data; boundary=...", matched case-insensitively.
    const contentType = c.req.header("content-type");
    const isMultipart =
      contentType != null &&
      contentType.toLowerCase().includes("multipart/form-data");
    const effectiveMax = isMultipart ? MULTIPART_MAX_BODY_BYTES : maxBytes;

    // Fast-path: trust a sane Content-Length header and fail-fast without
    // reading any body bytes.
    const contentLength = c.req.header("content-length");
    if (contentLength != null) {
      const len = Number(contentLength);
      if (!Number.isFinite(len) || len < 0 || len > effectiveMax) {
        c.header("Content-Length", "0");
        return c.json(
          { error: `request body exceeds ${effectiveMax} bytes limit` },
          413,
        );
      }
    }

    // Slow-path: no reliable Content-Length (chunked / omitted / NaN /
    // negative). Stream-consume until the limit is breached; this blocks the
    // attacker's unbounded body while keeping per-request allocation capped.
    const rawBody = c.req.raw.body;
    if (rawBody === null) {
      await next();
      return;
    }

    const reader = rawBody.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > effectiveMax) {
          c.header("Content-Length", "0");
          return c.json(
            { error: `request body exceeds ${effectiveMax} bytes limit` },
            413,
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    // Body was validated byte-for-byte; restore it as a fresh readable stream
    // so downstream handlers (e.g. c.req.parseBody()) still see the payload.
    c.req.raw = new Request(c.req.raw, {
      method: c.req.raw.method,
      headers: c.req.raw.headers,
      duplex: "half",
      body: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      }),
    });

    await next();
  });
}
