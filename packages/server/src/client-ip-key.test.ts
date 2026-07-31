// Regression test for the write-path rate-limiter key bug.
//
// routes/messages.ts and routes/participants.ts used to call `rateLimit({...})`
// WITHOUT a `key`, so rateLimit fell back to `getClientIp(c)` with no
// `getConnInfo` -> which returns the literal string "unknown". That collapsed
// the 15/min write cap (and the 10/min auth cap) onto a single site-wide
// bucket: concurrent users tripped 429s and POST /messages "often failed".
//
// `clientIpKey` is the production wiring that prevents this - it threads the
// real `getConnInfo` (socket address) and the `trustedProxy` flag into
// `getClientIp`. These tests pin that wiring by mounting a limiter keyed on
// `clientIpKey` and asserting that different socket IPs get separate buckets
// (the behavior that was broken when the key was always "unknown").

import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { _clearCleanup, clientIpKey, rateLimit } from "./rate-limit.js";

// Mock @hono/node-server/conninfo so clientIpKey reads a deterministic socket
// address instead of a real network connection. vi.mock is hoisted + scoped to
// this file, so the broader suite in rate-limit.test.ts (which injects a
// getConnInfo directly into getClientIp) is unaffected.
const mockConnInfo = vi.fn(() => ({ remote: { address: "127.0.0.1" } }));
vi.mock("@hono/node-server/conninfo", () => ({
  getConnInfo: () => mockConnInfo(),
}));

afterEach(() => {
  _clearCleanup();
  mockConnInfo.mockReset();
  mockConnInfo.mockReturnValue({ remote: { address: "127.0.0.1" } });
});

function mkApp(): Hono {
  const app = new Hono();
  // max: 1 per window - the second hit from the SAME ip must 429, while a hit
  // from a DIFFERENT ip must still 200. That contrast is exactly what "unknown"
  // bucketing would collapse (both would 429).
  app.use("/test", rateLimit({ max: 1, windowMs: 60_000, key: clientIpKey }), (c) =>
    c.json({ ok: true }),
  );
  return app;
}

describe("clientIpKey - production rate-limit key wiring", () => {
  it("keys the bucket on the socket IP, not 'unknown' (separate clients get separate buckets)", async () => {
    const app = mkApp();

    mockConnInfo.mockReturnValue({ remote: { address: "203.0.113.7" } });
    expect((await app.request("/test")).status).toBe(200); // first hit, IP A
    expect((await app.request("/test")).status).toBe(429); // second hit, IP A -> limited

    // A different client (different socket IP) MUST still be allowed. Under the
    // old "unknown" key this would have been a 429 - the whole-site bucket.
    mockConnInfo.mockReturnValue({ remote: { address: "198.51.100.42" } });
    expect((await app.request("/test")).status).toBe(200);
  });

  it("returns the real IP from getConnInfo (never 'unknown' when a socket address exists)", () => {
    // Directly assert the key value so a future refactor that drops getConnInfo
    // fails loudly here instead of silently re-collapsing the bucket.
    mockConnInfo.mockReturnValue({ remote: { address: "203.0.113.9" } });
    const app = new Hono();
    let captured: string | undefined;
    app.use("/x", (c) => {
      captured = clientIpKey(c);
      return c.json({ ok: true });
    });
    void app.request("/x");
    expect(captured).toBe("203.0.113.9");
    expect(captured).not.toBe("unknown");
  });
});
