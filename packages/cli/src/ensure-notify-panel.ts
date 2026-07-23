// Mandatory base-dependency bootstrap: guarantee notify-panel is installed and
// running before a club command that relies on it executes.
//
// club CLI redirects all received platform messages into the local notify-panel
// inbox, so notify-panel is no longer optional — without it, `listen`/`mentions`
// would silently drop every message. This module is the gate that keeps that
// contract: it (1) checks notify-panel is on PATH, installing it globally if not;
// (2) checks the daemon is running, starting it if not; (3) resolves the real
// daemon URL (the port is dynamic, so callers must read it, never hard-code).
//
// The whole thing runs inside each relying command's action (listen/mentions),
// so by the time the SSE stream or poll fires, a reachable inbox URL is in hand.
// Failures are surfaced on stderr (so the operator can fix the base dep) but,
// per the project rule that "a base-dep hiccup must never block the user's
// command", ultimately fail open — the command proceeds and pushes no-op.
//
// Discovery is delegated to notify-panel's own `url` subcommand whenever
// possible: it centralizes the precedence (NOTIFY_PANEL_URL env > port file >
// default 8787) so we don't reimplement it here. The port-file fallback covers
// an absent/non-JSON-printing `url` subcommand on very old installs.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { PushInput } from "./notify.js";

/** npm package name of the base dependency. */
const PKG = "notify-panel";
/** Hard timeout for the global install — npm can hang on a flaky registry. */
const INSTALL_TIMEOUT_MS = 120_000;
/** Where to send the operator when notify-panel isn't installable from npm. */
const INSTALL_HINT =
  "notify-panel is not yet on the public npm registry. Install it from source:\n" +
  "  git clone https://github.com/vat-wiki/notify-panel && " +
  "cd notify-panel && npm install && npm run build && cd packages/cli && npm link\n" +
  "then: notify-panel start";

/** Shell flag: Windows needs `shell: true` to resolve `npm`/binaries on PATH. */
const SHELL = process.platform === "win32";

/**
 * Indirection over node:child_process so tests can stub the subprocess layer
 * without spawning real `notify-panel`/`npm` processes. Production code uses the
 * real `spawn`/`spawnSync`; tests swap `proc.spawnSync` / `proc.spawn`.
 */
export const proc = {
  spawnSync: spawnSync,
  spawn: spawn,
};

/**
 * Is the `notify-panel` binary resolvable on PATH? Uses spawnSync so the check
 * is synchronous and cheap — we don't want an awaitable round-trip for a mere
 * PATH probe on every command invocation.
 */
function isInstalled(): boolean {
  try {
    const r = proc.spawnSync("notify-panel", ["--version"], { stdio: "ignore", shell: SHELL });
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * Try to install notify-panel globally (`npm i -g notify-panel`). stderr is
 * inherited so the operator sees install progress/errors; stdout is dropped to
 * avoid corrupting a user pipe. Rejects on non-zero exit or spawn error — which
 * includes the common case where notify-panel isn't published to the configured
 * registry yet (the caller then prints the source-install hint).
 */
function install(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = proc.spawn("npm", ["i", "-g", PKG, "--no-progress"], {
      stdio: ["inherit", "ignore", "inherit"],
      shell: SHELL,
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), INSTALL_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`npm install ${PKG} failed (exit ${code})`));
    });
  });
}

/**
 * Run a `notify-panel <sub>` command synchronously. `captureStdout` returns the
 * stdout string (for `url --json`); otherwise stdout is dropped. stderr is always
 * inherited for visibility. Returns the exit code, or -1 on spawn error.
 */
function run(sub: string, args: string[] = [], captureStdout = false): { code: number; stdout: string } {
  try {
    const r = proc.spawnSync("notify-panel", [sub, ...args], {
      stdio: ["ignore", captureStdout ? "pipe" : "ignore", "inherit"],
      encoding: "utf8",
      shell: SHELL,
    });
    return { code: r.status ?? -1, stdout: typeof r.stdout === "string" ? r.stdout : "" };
  } catch {
    return { code: -1, stdout: "" };
  }
}

/**
 * Resolve the real daemon address, preferring notify-panel's own discovery.
 *
 * notify-panel's port is dynamic (auto-increments on conflict), so we must NOT
 * hard-code 8787. `notify-panel url --json` centralizes the precedence
 * (NOTIFY_PANEL_URL env > port file > default) and is the canonical path. Returns
 * null if discovery fails entirely (daemon not running, or an ancient install
 * without the `url` subcommand *and* no port file).
 */
export function resolveDaemonUrl(): { url: string; secret?: string } | null {
  // Preferred: delegate to notify-panel's own discovery.
  const { code, stdout } = run("url", ["--json"], true);
  if (code === 0) {
    try {
      const obj = JSON.parse(stdout) as { url?: string; secret?: string };
      if (typeof obj.url === "string") {
        return { url: obj.url, ...(obj.secret ? { secret: obj.secret } : {}) };
      }
    } catch {
      /* fall through to port-file read */
    }
  }
  // Fallback: direct port-file read (covers ancient installs lacking `url`).
  return readPortFile();
}

function readPortFile(): { url: string; secret?: string } | null {
  const file = join(homedir(), ".notify-panel", "server.json");
  if (!existsSync(file)) return null;
  try {
    const obj = JSON.parse(readFileSync(file, "utf8")) as { url?: string; secret?: string };
    if (typeof obj.url !== "string") return null;
    return { url: obj.url, ...(obj.secret ? { secret: obj.secret } : {}) };
  } catch {
    return null;
  }
}

/**
 * Guarantee notify-panel is installed and running, then resolve the daemon URL.
 *
 * Steps are made loud on stderr (the operator must know the base dep was
 * missing) but the whole function ultimately fails open: if anything
 * irrecoverable happens it returns null, the calling command proceeds, and any
 * `pushMessage` calls just no-op. We never abort the user's original command
 * over a base-dependency hiccup.
 *
 * Install path: we first try `npm i -g notify-panel` (works once it's published
 * or on a private registry); if that fails we print the source-install hint,
 * because as of writing notify-panel isn't on the public npm registry.
 *
 * @returns The reachable daemon { url, secret? } for pushing, or null.
 */
export async function ensureNotifyPanel(): Promise<PushInput | null> {
  // 1) Installed?
  if (!isInstalled()) {
    process.stderr.write(`club: base dependency '${PKG}' missing — installing…\n`);
    try {
      await install();
      process.stderr.write(`club: ${PKG} installed.\n`);
    } catch (err) {
      process.stderr.write(
        `club: could not auto-install ${PKG} (${(err as Error).message}).\n` +
          `${INSTALL_HINT}\n`,
      );
      return null;
    }
  }

  // 2) Running? (`status` exits 0 when up, non-zero when down.)
  if (run("status").code !== 0) {
    process.stderr.write(`club: ${PKG} daemon not running — starting…\n`);
    // Background start (default) forks and returns promptly; keep advertise ON
    // (the default) so `notify-panel url` can discover it via the port file.
    if (run("start").code !== 0) {
      process.stderr.write(
        `club: failed to start ${PKG} daemon; notifications disabled for this run. ` +
          "fix with: notify-panel start\n",
      );
      return null;
    }
  }

  // 3) Resolve the real URL via notify-panel's own discovery (port is dynamic).
  const info = resolveDaemonUrl();
  if (!info) {
    process.stderr.write(
      `club: ${PKG} daemon up but its address is undiscoverable; ` +
        "notifications disabled for this run.\n",
    );
    return null;
  }
  return info;
}
