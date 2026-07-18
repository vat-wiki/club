// Lightweight in-memory rate limiter for Hono.
// Uses a sliding-window counter per key (IP address by default).
// No external dependency — avoids adding hono-rate-limiter or similar.

interface Bucket {
  tokens: number;
  lastRefill: number;
}

// Module-level store so cleanup can evict stale entries.
const buckets = new Map<string, Bucket>();

// Periodic cleanup of stale buckets to prevent memory leak.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.lastRefill > 120_000) buckets.delete(key);
  }
}, 120_000).unref();

export function rateLimit(options: {
  max: number; // max requests per window
  windowMs: number; // window in milliseconds
  key?: (c: import("hono").Context) => string; // custom key extractor
}): import("hono").MiddlewareHandler {
  const { max, windowMs, key } = options;

  return async (c, next) => {
    const identifier = key ? key(c) : c.req.header("x-forwarded-for") ?? c.req.raw.headers.get("x-real-ip") ?? "unknown";

    const now = Date.now();
    let bucket = buckets.get(identifier);
    if (!bucket || now - bucket.lastRefill > windowMs) {
      bucket = { tokens: max, lastRefill: now };
      buckets.set(identifier, bucket);
    }

    if (bucket.tokens <= 0) {
      const remaining = Math.ceil((bucket.lastRefill + windowMs - now) / 1000);
      c.header("Retry-After", String(remaining));
      return c.json({ error: "rate limited" }, 429);
    }

    bucket.tokens--;
    await next();
  };
}
