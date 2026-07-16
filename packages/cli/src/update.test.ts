import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compareVersions,
  isNewer,
  CURRENT_VERSION,
  updateCachePath,
  fetchLatestVersion,
  checkForUpdate,
} from "./update.js";

// Each test gets a fresh temp dir for the cache, selected via CLUB_CONFIG (same mechanism
// config.ts uses), so updateCachePath() resolves under that dir and tests are isolated.
let tmpDir: string;
const fetchMock = vi.fn();

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "club-update-"));
  process.env.CLUB_CONFIG = join(tmpDir, "config.json");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(tmpDir, { recursive: true, force: true });
});

function readCacheFile(): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(updateCachePath(), "utf8"));
  } catch {
    return null;
  }
}

function writeCacheFile(obj: unknown): void {
  writeFileSync(updateCachePath(), JSON.stringify(obj));
}

/** Build a realistic 200 Response with the given registry payload. */
function registryResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("0.3.0", "0.3.0")).toBe(0);
  });
  it("orders patch differences", () => {
    expect(compareVersions("0.3.1", "0.3.0")).toBeGreaterThan(0);
    expect(compareVersions("0.3.0", "0.3.1")).toBeLessThan(0);
  });
  it("orders minor over patch", () => {
    expect(compareVersions("0.4.0", "0.3.9")).toBeGreaterThan(0);
  });
  it("orders major over everything", () => {
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
  });
  it("compares numerically, not lexically (0.10.0 > 0.9.0)", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
  });
  it("treats missing segments as 0 (1.2 == 1.2.0)", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
  });
  it("strips pre-release suffixes", () => {
    expect(compareVersions("1.2.3-rc.1", "1.2.3")).toBe(0);
  });
  it("treats leading zeros normally (01.02.03 == 1.2.3)", () => {
    expect(compareVersions("01.02.03", "1.2.3")).toBe(0);
  });
  it("coerces non-numeric segments to 0", () => {
    expect(compareVersions("x.y.z", "0.0.0")).toBe(0);
  });
});

describe("isNewer", () => {
  it("is true only when latest strictly exceeds current", () => {
    expect(isNewer("0.4.0", "0.3.0")).toBe(true);
    expect(isNewer("0.3.0", "0.3.0")).toBe(false);
    expect(isNewer("0.2.0", "0.3.0")).toBe(false);
  });
});

describe("updateCachePath", () => {
  it("lives next to CLUB_CONFIG", () => {
    expect(updateCachePath()).toBe(join(tmpDir, "update-cache.json"));
  });
});

describe("fetchLatestVersion", () => {
  it("returns the version field on a 200", async () => {
    fetchMock.mockResolvedValueOnce(registryResponse({ version: "0.4.0" }));
    expect(await fetchLatestVersion()).toBe("0.4.0");
  });
  it("returns null on non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(registryResponse({ version: "0.4.0" }, 500));
    expect(await fetchLatestVersion()).toBeNull();
  });
  it("returns null when fetch rejects (network/timeout)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect(await fetchLatestVersion()).toBeNull();
  });
  it("returns null when the version field is missing", async () => {
    fetchMock.mockResolvedValueOnce(registryResponse({}));
    expect(await fetchLatestVersion()).toBeNull();
  });
  it("returns null when the version field is malformed", async () => {
    fetchMock.mockResolvedValueOnce(registryResponse({ version: "not-a-version" }));
    expect(await fetchLatestVersion()).toBeNull();
  });
});

describe("checkForUpdate", () => {
  it("fetches and reports an update when no cache exists", async () => {
    fetchMock.mockResolvedValueOnce(registryResponse({ version: "99.0.0" }));
    const r = await checkForUpdate();
    expect(r).toEqual({ update: true, latest: "99.0.0" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const cache = readCacheFile();
    expect(cache?.latest).toBe("99.0.0");
    expect(typeof cache?.checkedAt).toBe("number");
  });

  it("uses a fresh cache without hitting the network", async () => {
    writeCacheFile({ latest: "99.0.0", checkedAt: Date.now() });
    const r = await checkForUpdate();
    expect(r).toEqual({ update: true, latest: "99.0.0" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not report an update when the fresh cache matches current", async () => {
    writeCacheFile({ latest: CURRENT_VERSION, checkedAt: Date.now() });
    const r = await checkForUpdate();
    expect(r.update).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-fetches once the TTL has elapsed", async () => {
    const stale = Date.now() - 25 * 60 * 60 * 1000; // 25h ago
    writeCacheFile({ latest: "99.0.0", checkedAt: stale });
    fetchMock.mockResolvedValueOnce(registryResponse({ version: CURRENT_VERSION }));
    const r = await checkForUpdate();
    expect(r.update).toBe(false); // registry now reports our own version
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readCacheFile()?.latest).toBe(CURRENT_VERSION);
  });

  it("advances checkedAt but keeps no latest when fetch fails", async () => {
    // No cache + network failure: must not report update, must still record checkedAt so
    // the next command within TTL doesn't pay the timeout again.
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const r = await checkForUpdate();
    expect(r).toEqual({ update: false, latest: null });
    const cache = readCacheFile();
    expect(cache?.latest).toBeUndefined();
    expect(typeof cache?.checkedAt).toBe("number");

    // Within TTL now: no further fetch even though we never learned a latest.
    fetchMock.mockReset();
    const r2 = await checkForUpdate();
    expect(r2).toEqual({ update: false, latest: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips entirely while install-failure backoff is active", async () => {
    writeCacheFile({ latest: "99.0.0", checkedAt: Date.now(), skipUntil: Date.now() + 60_000 });
    const r = await checkForUpdate();
    expect(r).toEqual({ update: false, latest: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears backoff once skipUntil has passed", async () => {
    writeCacheFile({ latest: "99.0.0", checkedAt: Date.now() - 25 * 60 * 60 * 1000, skipUntil: Date.now() - 1000 });
    fetchMock.mockResolvedValueOnce(registryResponse({ version: "99.0.0" }));
    const r = await checkForUpdate();
    expect(r).toEqual({ update: true, latest: "99.0.0" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
