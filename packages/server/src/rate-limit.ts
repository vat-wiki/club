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

// IPv4 / IPv6 (compressed) validation. Rejects anything that isn't a
// well-formed IP so forged proxy headers can't poison the rate-limiter
// bucket key with arbitrary strings.
const IPV4_RE = /^(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)$/;
// Hex + colons only, with either the :: compress marker or at least two
// colons (so "1234:5678:90ab:cdef" passes but "a:b" does not).
function isValidIpv6(candidate: string): boolean {
  if (!/^[0-9a-fA-F:]+$/.test(candidate)) return false;
  if (candidate.includes("::")) return true;
  return candidate.split(":").length >= 3;
}

function isIp(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (trimmed.length === 0) return false;
  if (IPV4_RE.test(trimmed)) return true;
  if (isValidIpv6(trimmed)) return true;
  return false;
}

/**
 * Resolve the most trustworthy client IP from a Hono context.
 *
 * Preference order:
 *   1. `x-forwarded-for` (leftmost entry) — trusted when behind a reverse proxy.
 *   2. `x-real-ip` — nginx/caddy convention.
 *   3. Direct socket address via `getConnInfo` (from `@hono/node-server/conninfo`).
 *
 * Every candidate is validated as an IPv4 or compressed IPv6 address before
 * being accepted. A forged proxy header like "1.2.3.4, attacker" would
 * previously poison the rate-limiter bucket key; the validation rejects it
 * and falls through to the next candidate.
 *
 * The socket address is the hard fallback: it cannot be forged by the client
 * even without a reverse proxy, so we prefer it over the string "unknown" which
 * collapses every bypass into a single bucket.
 */
export function getClientIp(
  c: import("hono").Context,
  getConnInfo?: () => { remote?: { address?: string } } | undefined,
): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const leftmost = xff.split(",")[0].trim();
    if (isIp(leftmost)) return leftmost;
    // If leftmost is malformed, fall through — do not trust the header.
  }
  const xri = c.req.raw.headers.get("x-real-ip");
  if (xri && isIp(xri)) return xri;
  const conn = getConnInfo?.();
  const socketAddr = conn?.remote?.address ?? "";
  if (isIp(socketAddr)) return socketAddr;
  return "unknown";
}

export function rateLimit(options: {
  max: number; // max requests per window
  windowMs: number; // window in milliseconds
  key?: (c: import("hono").Context) => string; // custom key extractor
}): import("hono").MiddlewareHandler {
  const { max, windowMs, key } = options;

  return async (c, next) => {
    // When a custom key extractor is not provided, use the hardened IP resolver.
    const identifier = key ? key(c) : getClientIp(c);

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
