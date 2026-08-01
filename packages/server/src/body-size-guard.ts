import { createMiddleware } from "hono/factory";

// Default maximum request body size for non-multipart requests. Multipart
// form-data uploads are SKIPPED by this guard (see the early return in
// bodySizeGuard) and bounded instead by the files route's per-kind cap
// (video 50 MB / document 25 MB / image 10 MB), which is far higher than
// 5 MB. JSON routes that accept message content, reactions, channel
// creation, etc. are all bounded by this 5 MB limit - large enough for any
// realistic JSON payload while capping a request-body DoS where an attacker
// feeds a multi-hundred-MB body that forces the server to buffer it into
// memory before the route handler runs.
export const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;

/**
 * Build a middleware that rejects requests whose body exceeds the configured
 * limit, returning a 413 with a human-readable error message.
 *
 * Multipart/form-data requests are exempted entirely (passed through via
 * `next()`): the files route enforces a much higher per-kind cap
 * (video 50 MB / document 25 MB / image 10 MB) on the parsed `File`, so
 * enforcing this guard's small limit here would reject legitimate large
 * uploads before they reach the files handler. The exemption is matched
 * case-insensitively against the Content-Type header.
 *
 * Fast-path: if a `Content-Length` header is present and finite, reject
 * immediately when the declared size exceeds the cap — no body bytes are read.
 * Slow-path: for chunked or otherwise unbounded transfers (no / bogus / negative
 * `Content-Length`), consume the request body stream in chunks until either the
 * limit is breached (413) or the stream ends naturally (pass-through).
 *
 * Checked at the earliest point in the pipeline (before body parsing / route
 * handlers) so memory is never consumed for oversized requests.
 *
 * @param maxBytes - Maximum allowed body size in bytes.
 */
export function bodySizeGuard(maxBytes = DEFAULT_MAX_BODY_BYTES) {
  return createMiddleware(async (c, next) => {
    // Multipart/form-data uploads are exempted: the files route enforces a
    // per-kind cap (video 50 MB / document 25 MB / image 10 MB) far above
    // this guard's limit, so enforcing 5 MB here would reject legitimate
    // large uploads before they ever reach the files handler. The content
    // type arrives as "multipart/form-data; boundary=...", matched
    // case-insensitively.
    const contentType = c.req.header("content-type");
    if (contentType?.toLowerCase().includes("multipart/form-data")) {
      await next();
      return;
    }

    // Fast-path: trust a sane Content-Length header and fail-fast without
    // reading any body bytes.
    const contentLength = c.req.header("content-length");
    if (contentLength != null) {
      const len = Number(contentLength);
      if (!Number.isFinite(len) || len < 0 || len > maxBytes) {
        c.header("Content-Length", "0");
        return c.json(
          { error: `request body exceeds ${maxBytes} bytes limit` },
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
        if (size > maxBytes) {
          c.header("Content-Length", "0");
          return c.json(
            { error: `request body exceeds ${maxBytes} bytes limit` },
            413,
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    // Body was validated byte-for-byte; restore it as a fresh readable stream
    // so downstream handlers (e.g. c.req.json()) still see the payload.
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
