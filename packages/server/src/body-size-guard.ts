import { createMiddleware } from "hono/factory";

// Default maximum request body size. Uploads (multipart) are handled by the
// files route with a much higher per-kind cap, but JSON routes that accept
// message content, reactions, room creation, etc. are all bounded by this.
// 5 MB is large enough for any realistic JSON payload while capping a
// request-body DoS where an attacker feeds a multi-hundred-MB body that
// forces the server to buffer it into memory before the route handler runs.
export const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;

/**
 * Build a middleware that rejects requests whose body exceeds the configured
 * limit, returning a 413 with a human-readable error message.
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
    // Fast-path: trust a sane Content-Length header and fail-fast without
    // reading any body bytes.
    const contentLength = c.req.header("content-length");
    if (contentLength !== null) {
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
