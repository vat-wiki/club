// Runtime files for the `club listen` daemon: PID + log under `~/.club/`.
//
// Mirrors notify-panel's daemon-manager pattern (a single well-known dir holds
// the PID file and a tail-able log). `~/.club/` is chosen so `CLUB_CONFIG`
// relocates the whole runtime tree together (config, update cache, listen
// daemon state), and so the system service — which runs as the same user —
// reads the same HOME and finds these files without extra wiring.

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { configPath } from "./config.js";

/**
 * Root of club's per-user runtime state. Sits next to `config.json` so
 * `CLUB_CONFIG` moves everything together.
 */
export function runtimeDir(): string {
  return dirname(configPath());
}

/** PID file: records the running listen daemon's process id. */
export function pidFilePath(): string {
  return join(runtimeDir(), "listen.pid");
}

/** Log file: the daemon's combined stdout/stderr. */
export function logFilePath(): string {
  return join(runtimeDir(), "listen.log");
}

/** Read the daemon PID from disk, or null if absent/invalid. */
export function readPidFile(): number | null {
  try {
    const raw = readFileSync(pidFilePath(), "utf8").trim();
    const pid = Number(raw);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Persist the daemon PID. Creates the runtime dir if needed. */
export function writePidFile(pid: number): void {
  mkdirSync(runtimeDir(), { recursive: true });
  writeFileSync(pidFilePath(), String(pid));
}

/** Remove the PID file (best-effort; ignores missing). */
export function clearPidFile(): void {
  try {
    unlinkSync(pidFilePath());
  } catch {
    /* ignore */
  }
}

/**
 * Is a process with the given PID alive?
 *
 * `process.kill(pid, 0)` sends no signal — it only checks existence. An EPERM
 * means the process exists but is owned by another user, so we still treat it
 * as alive.
 */
export function isAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Append a startup banner to the log so each invocation is easy to find.
 * Opens/closes the fd synchronously around the write — the caller (the daemon
 * spawner) is about to hand the log fd off to a detached child, so we must not
 * hold it open here.
 */
export function appendLogBanner(msg: string): void {
  mkdirSync(runtimeDir(), { recursive: true });
  const fd = openSync(logFilePath(), "a");
  try {
    writeSync(fd, msg);
  } finally {
    closeSync(fd);
  }
}

/** Read the last `lines` lines of the log (default 50). "(no logs)" if absent. */
export function tailLog(lines = 50): string {
  try {
    const raw = readFileSync(logFilePath(), "utf8");
    const all = raw.split("\n");
    return all.slice(Math.max(0, all.length - lines)).join("\n");
  } catch {
    return "(no logs)";
  }
}

/**
 * Resolve the absolute path to the `club` CLI entry this process is running.
 *
 * Used to write the `ExecStart`/`ProgramArguments` of a system service and to
 * re-spawn the daemon. `process.argv[1]` is the script path under Node; we
 * realpath it so a globally-installed symlink (`/usr/bin/club` → the real
 * `cli.js`) is resolved to its true target. Falls back to `process.argv[1]`
 * when realpath fails or the file isn't where we expect.
 */
export function resolveClubBin(): string | null {
  const argv1 = process.argv[1] || "";
  try {
    const real = realpathSafe(argv1);
    if (real) return real;
  } catch {
    /* fall through */
  }
  if (argv1 && existsSync(argv1)) return argv1;
  return null;
}

function realpathSafe(p: string): string | null {
  try {
    const real = realpathSync(p);
    return existsSync(real) ? real : null;
  } catch {
    return null;
  }
}
