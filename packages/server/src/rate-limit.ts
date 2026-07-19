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
// `setTimeout` sleeps. Production calls `Date.now`. Because ESM `export` bindings
// are immutable, we use a mutable wrapper (the `__clock` symbol is never part of
// the public API).
const _clock = { fn: Date.now as () => number };
export const _getNow: () => number = () => _clock.fn();
export function _setNow(fn: () => number): void {
  _clock.fn = fn;
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
