// Self-update machinery for club-cli.
//
// Two entry points:
//   • `club update`              — manual, forces a registry fetch (see commands/update.ts).
//   • preAction hook in index.ts — checks before every command, with a 24h TTL cache so
//     high-frequency commands (send/listen) aren't slowed down.
//
// Philosophy: every step is best-effort and fails open. A flaky network, missing global
// write permission, or a non-global install must never block the user's real command.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import pkg from "../package.json" with { type: "json" };
import { configPath } from "./config.js";

// The published package lives at `club-cli` on npm (bin: `club`).
const REGISTRY_URL = "https://registry.npmjs.org/club-cli/latest";
const FETCH_TIMEOUT_MS = 5_000;
const TTL_MS = 24 * 60 * 60 * 1000; // re-fetch at most once per day
const INSTALL_BACKOFF_MS = 60 * 60 * 1000; // after a failed install, don't retry for 1h
const VERSION_RE = /^\d+\.\d+\.\d+/; // accept any leading x.y.z (pre-release tags stripped later)

/** Current club-cli version, baked in at build time. Single source of truth. */
export const CURRENT_VERSION: string = pkg.version;

/**
 * Where the update cache lives: next to the config file (`~/.club/update-cache.json`),
 * so `CLUB_CONFIG` relocates both together.
 */
export function updateCachePath(): string {
  return join(dirname(configPath()), "update-cache.json");
}

interface UpdateCache {
  /** Last-known latest version from npm. */
  latest?: string;
  /** When we last successfully contacted the registry (ms epoch). */
  checkedAt?: number;
  /** If set, skip the whole update flow until this time (install-failure backoff). */
  skipUntil?: number;
}

// --- semver (hand-rolled; no dependency) -------------------------------------

/**
 * Compare two version strings. Returns <0 if a<b, 0 if equal, >0 if a>b.
 * Pre-release suffixes are stripped (`1.2.3-rc` ranks as `1.2.3`); missing/NaN segments
 * count as 0. Club has never used pre-release tags, so this is intentionally simple.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .split("-")[0]
      .split(".")
      .map((s) => {
        const n = Number(s);
        return Number.isFinite(n) ? n : 0;
      });
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

export function isNewer(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}

// --- cache I/O (mirrors src/config.ts) ---------------------------------------

function readCache(): UpdateCache {
  try {
    const raw = readFileSync(updateCachePath(), "utf8");
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? (obj as UpdateCache) : {};
  } catch {
    return {};
  }
}

function writeCache(c: UpdateCache): void {
  try {
    const p = updateCachePath();
    if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(c, null, 2) + "\n", "utf8");
  } catch {
    /* cache writes are best-effort */
  }
}

// --- registry lookup ---------------------------------------------------------

/**
 * Fetch the latest published version from npm. Returns null on any failure
 * (network, non-2xx, malformed body, timeout) — callers treat null as "unknown".
 */
export async function fetchLatestVersion(): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(REGISTRY_URL, { signal: ctrl.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as { version?: string };
    const v = json?.version;
    return typeof v === "string" && VERSION_RE.test(v) ? v : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * TTL-aware update check.
 *
 * - Within TTL: uses the cached `latest` (no network).
 * - Past TTL: fetches fresh; on success updates `latest`, and **always** updates
 *   `checkedAt` (even on fetch failure) so a prolonged outage doesn't make every
 *   single command pay the 5s timeout — the TTL still advances, and a previously
 *   known `latest` stays usable.
 * - Honors `skipUntil` (install-failure backoff): skip entirely until it expires.
 */
export async function checkForUpdate(): Promise<{ update: boolean; latest: string | null }> {
  const cache = readCache();
  const now = Date.now();

  if (typeof cache.skipUntil === "number" && now < cache.skipUntil) {
    return { update: false, latest: null };
  }

  const fresh = typeof cache.checkedAt === "number" && now - cache.checkedAt < TTL_MS;
  let latest: string | null;

  if (fresh) {
    // No network: reuse whatever we knew, if anything.
    latest = typeof cache.latest === "string" ? cache.latest : null;
  } else {
    latest = await fetchLatestVersion();
    // Advance checkedAt regardless; only adopt a freshly-fetched latest.
    writeCache({ ...cache, ...(latest ? { latest } : {}), checkedAt: now });
  }

  if (!latest) return { update: false, latest: null };
  return { update: isNewer(latest, CURRENT_VERSION), latest };
}

// --- install + relaunch ------------------------------------------------------

/**
 * Run `npm i -g club-cli@latest`.
 *
 * stdout is dropped (`'ignore'`) so npm's summary never corrupts a user pipe such as
 * `club members | jq` — we only inherit stderr so install progress/errors are visible.
 */
export function runSelfUpdate(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("npm", ["i", "-g", "club-cli@latest", "--no-progress"], {
      stdio: ["inherit", "ignore", "inherit"],
      // Windows needs a shell to resolve `npm` on PATH.
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm install failed (exit ${code})`));
    });
  });
}

/**
 * Re-execute the current binary with the exact same argv, but flagged to skip the
 * update check (prevents a loop). Waits for the child and exits with its code, so the
 * caller's original action never runs in this (old) process.
 *
 * Uses `process.execPath` (node) + `process.argv[1]` (bin/club.js) rather than relying
 * on a `club` shim being on PATH — more portable across platforms.
 */
export function relaunchWithSameArgs(): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const child = spawn(process.execPath, [process.argv[1], ...process.argv.slice(2)], {
      stdio: "inherit",
      env: { ...process.env, CLUB_NO_UPDATE_CHECK: "1" },
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      process.exit(code ?? (signal ? 128 : 0));
    });
  });
}

/**
 * Install the new version, then relaunch to continue the user's original command on the
 * new code. On success this never returns (the relaunch exits the process). On any
 * failure it writes an install-failure backoff and returns, letting the caller fall
 * through to the original command on the old version.
 */
export async function autoUpdateAndRelaunch(latest: string): Promise<void> {
  process.stderr.write(`club: updating club-cli ${CURRENT_VERSION} → ${latest}\n`);
  try {
    await runSelfUpdate();
    await relaunchWithSameArgs(); // never returns on success
  } catch {
    const cache = readCache();
    writeCache({ ...cache, skipUntil: Date.now() + INSTALL_BACKOFF_MS });
    process.stderr.write(
      `club: auto-update failed, continuing with ${CURRENT_VERSION}. run: club update\n`,
    );
  }
}

/**
 * True when club is launched via tsx against the TypeScript source (e.g. `npm -w club-cli
 * run dev`), where self-updating the published npm package makes no sense.
 */
export function isDevRun(): boolean {
  const a1 = process.argv[1] ?? "";
  return /[/\\]src[/\\]index\.[tj]sx?$/.test(a1);
}
