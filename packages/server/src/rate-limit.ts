// Lightweight fixed-window rate limiter for Hono.
//
// Fixed-window semantics: each unique key gets a bucket that resets to `max`
// tokens at the start of its window and depletes on each request. Once the
// window expires the bucket is fully replenished — partial refill is not
// attempted (a true sliding-window counter is simpler and cheaper than a
// leaky-bucket or token-bucket model, which we do not need at this scale).
//
// The module keeps no external dependency; hono-rate-limiter is overkill.
//
// Internal clock is a module export (`_getNow`) so tests can pin time without
// relying on `setTimeout`. Production code calls `Date.now` directly.
// Exported only for tests; underscore prefix signals "private API".

interface Bucket {
  // Last moment the window started (used to decide when it expires).
  windowStart: number;
  // Tokens remaining in the current window.
  tokens: number;
}

// Module-level store; `_cleanup` evicts stale entries on a background timer.
const buckets = new Map<string, Bucket>();

// Internal clock exported for tests so time-related assertions don't depend on
// `setTimeout` sleeps. Production calls `Date.now`. Wrapped in an object so the
// function reference can be reassigned at module scope without relying on a
// mutable ESM export binding.
const _clock = { current: Date.now };
export function _getNow(): number {
  return _clock.current();
}
/** Replaces the internal clock. Primarily for tests so time-dependent assertions
 *  don't depend on real `setTimeout` sleeps. Production never calls this. */
export function _setNow(fn: () => number): void {
  _clock.current = fn;
}

// Periodic cleanup of stale buckets to prevent memory leak.
// `unref()` keeps the timer from blocking Node's event loop once all other
// handles are idle (e.g. in tests or single-shot requests).
_cleanupRef = setInterval(_cleanup, 120_000).unref();

function _cleanup(): void {
  const now = _getNow();
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.windowStart > 120_000) buckets.delete(key);
  }
}

/** Releases the background cleanup timer. Primarily for tests so the GC can
 *  walk away cleanly; not required in production (the unref'd timer won't
 *  prevent process exit). */
export function _clearCleanup(): void {
  if (_cleanupRef) clearInterval(_cleanupRef);
}

// eslint-disable-next-line no-var -- mutable ref kept alive across calls
var _cleanupRef: ReturnType<typeof setInterval> | undefined;

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
 * When `trustedProxy` is `true` (server is behind a trusted reverse proxy that
 * sets the forwarding headers), the resolver reads proxy headers:
 *   1. `x-forwarded-for` (leftmost entry)
 *   2. `x-real-ip` — nginx/caddy convention
 * and uses the socket address as a fallback.
 *
 * When `trustedProxy` is `false` (default, direct-to-server deployment), proxy
 * headers are ignored entirely and the socket address is used as the sole source
 * of truth. This prevents an attacker who can reach the server directly from
 * forging a forwarding header to bypass the per-IP rate limit.
 *
 * Every candidate IP is validated as a well-formed IPv4 or compressed IPv6
 * before acceptance; malformed values are rejected and the resolver falls
 * through.
 *
 * @param c - Hono request context.
 * @param getConnInfo - Supplier for the direct socket address
 *   (`@hono/node-server/conninfo`).
 * @param trustedProxy - Whether proxy forwarding headers should be trusted.
 *   Default `false` (safe default for direct connections).
 * @returns The resolved client IP, or `"unknown"` if nothing reliable is
 *   available.
 */
export function getClientIp(
  c: import("hono").Context,
  getConnInfo?: () => { remote?: { address?: string } } | undefined,
  trustedProxy = false,
): string {
  if (trustedProxy) {
    const xff = c.req.header("x-forwarded-for");
    if (xff) {
      const leftmost = xff.split(",")[0].trim();
      if (isIp(leftmost)) return leftmost;
      // If leftmost is malformed, fall through — do not trust the header.
    }
    const xri = c.req.raw.headers.get("x-real-ip");
    if (xri && isIp(xri)) return xri;
  }
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

    const now = _getNow();
    let bucket = buckets.get(identifier);
    if (!bucket || now - bucket.windowStart >= windowMs) {
      // Window has expired (or never existed) — start a fresh one.
      bucket = { windowStart: now, tokens: max };
      buckets.set(identifier, bucket);
    }

    if (bucket.tokens <= 0) {
      // Window is fixed: the bucket won't refill until the original window
      // expires, regardless of how much time has elapsed within it. This
      // matches fixed-window semantics and prevents a client from getting a
      // partial refill mid-window.
      const remaining = Math.ceil((bucket.windowStart + windowMs - now) / 1000);
      c.header("Retry-After", String(remaining));
      return c.json({ error: "rate limited" }, 429);
    }

    bucket.tokens--;
    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(bucket.tokens));
    await next();
  };
}
