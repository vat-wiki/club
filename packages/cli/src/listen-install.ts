// System-service registration for the `club listen` daemon.
//
// Two platform backends, mirroring notify-panel's install.ts (battle-tested):
//   • Linux:  systemd user unit at ~/.config/systemd/user/club-listen.service
//   • macOS:  launchd plist at ~/Library/LaunchAgents/dev.club.listen.plist
//
// The generated service runs `node <club-bin> listen --foreground ...` as a
// *foreground* process under the service manager's supervision. We deliberately
// do NOT use `--daemon` here: the service manager is the supervisor — it needs
// to own the process so its Restart/WantedBy knobs have something to act on.
// A double-daemon (detached child of a service) would escape supervision and
// defeat the whole point.
//
// Why a separate command (not a postinstall hook): registration requires the
// user to already be logged in (config.json), runs platform-specific system
// tooling (systemctl/launchctl) that is unreliable in npm's non-interactive
// install context, and is a side effect users should opt into explicitly.
// See commands/listen.ts for the user-facing flags.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { logFilePath } from "./listen-runtime.js";

/** Systemd user service name. */
export const SERVICE_NAME = "club-listen";
/** launchd label (reverse-DNS, conventional). */
export const LAUNCHD_LABEL = "dev.club.listen";

export interface ServiceOpts {
  /** Absolute path to the node binary that should run the service. */
  nodeBin: string;
  /** Absolute path to the `club` CLI script (the value npm puts in `bin`). */
  cliBin: string;
  /** Extra `club listen` flags to bake into the service (e.g. ["--mention","x"]). */
  extraArgs: string[];
  /** Generate the file(s) but don't enable/start them. */
  noStart?: boolean;
}

/**
 * Install the system service for the current platform.
 *
 * @throws {Error} with a guidance message on unsupported platforms or when the
 *   platform's service tooling is unavailable.
 */
export function installService(opts: ServiceOpts): void {
  if (process.platform === "linux") {
    installSystemd(opts);
  } else if (process.platform === "darwin") {
    installLaunchd(opts);
  } else {
    throw new Error(
      `auto-install is not supported on ${process.platform}. ` +
        "Register a service manually (Windows: nssm / Task Scheduler; others: init scripts).",
    );
  }
}

/** Uninstall + disable the system service for the current platform. */
export function uninstallService(): void {
  if (process.platform === "linux") {
    uninstallSystemd();
  } else if (process.platform === "darwin") {
    uninstallLaunchd();
  } else {
    throw new Error(`auto-uninstall is not supported on ${process.platform}.`);
  }
}

/**
 * Is the installed system service currently active? Returns null when no
 * platform backend or no tooling is available (so callers can fall back to
 * the PID-file check). Never throws — service tooling is best-effort.
 */
export function serviceStatus(): boolean | null {
  try {
    if (process.platform === "linux") {
      // `is-active` prints "active"/"inactive"/"failed" and exits 0 only when
      // active. Capture stdout to read the result; ignore stderr so a
      // non-active result doesn't spam the user.
      const r = execFileSync(
        "systemctl",
        ["--user", "is-active", SERVICE_NAME],
        { stdio: ["ignore", "pipe", "ignore"] },
      );
      return r.toString().trim() === "active";
    }
    if (process.platform === "darwin") {
      // `launchctl list <label>` prints a plist with a PID line when loaded.
      try {
        const out = execFileSync("launchctl", ["list", LAUNCHD_LABEL], {
          stdio: ["ignore", "pipe", "ignore"],
        })
          .toString()
          .trim();
        // A loaded, running job has "PID" = <number>"; a loaded-but-exited
        // job has "PID" = "-". We treat a numeric PID as active.
        return /^PID\s*=\s*\d+/m.test(out);
      } catch {
        return false;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Stop the installed system service (without uninstalling it). Best-effort:
 * returns false if no backend, no tooling, or no loaded service — never
 * throws, never leaks systemctl output. --stop uses this to decide whether
 * to fall through to the PID-file path, so a missing service must return
 * false cleanly rather than printing "Unit not loaded".
 */
export function serviceStop(): boolean {
  if (process.platform !== "linux" && process.platform !== "darwin") {
    return false;
  }
  try {
    if (process.platform === "linux") {
      // Only attempt a stop if the unit is actually loaded. `is-active` exits
      // non-zero (and prints "inactive"/"unknown") for a missing/stopped unit;
      // "active" means it's running and we should stop it.
      const r = execFileSync(
        "systemctl",
        ["--user", "is-active", SERVICE_NAME],
        { stdio: ["ignore", "pipe", "ignore"] },
      )
        .toString()
        .trim();
      if (r !== "active") return false;
      execFileSync(
        "systemctl",
        ["--user", "stop", SERVICE_NAME],
        { stdio: ["ignore", "ignore", "ignore"] },
      );
      return true;
    }
    // darwin
    const plistPath = join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
    if (!existsSync(plistPath)) return false;
    execFileSync("launchctl", ["unload", plistPath], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ── systemd (Linux) ──────────────────────────────────────────────────

function installSystemd(opts: ServiceOpts): void {
  const unitDir = join(homedir(), ".config", "systemd", "user");
  const unitPath = join(unitDir, `${SERVICE_NAME}.service`);
  mkdirSync(unitDir, { recursive: true });

  // systemd's ExecStart is shell-evaluated; shell-quote each argv piece so
  // flags with spaces (e.g. a --mention name) survive intact.
  const argv = [opts.nodeBin, opts.cliBin, "listen", "--foreground", ...opts.extraArgs];
  const execStart = argv.map(shellQuote).join(" ");

  const unit = `[Unit]
Description=Club listen daemon (SSE → notify-panel forwarder)
After=network.target

[Service]
Type=simple
ExecStart=${execStart}
Restart=on-failure
RestartSec=3
# HOME must be set so the daemon can read ~/.club/config.json and write its
# PID/log files. user services inherit the invoking user's HOME, but set it
# explicitly for robustness across systemd versions.
Environment=HOME=${homedir()}
# PATH is captured from the shell at --install time: systemd user services run
# with a minimal PATH (/usr/bin:/bin...) that omits version managers (fnm/nvm)
# and ~/.local/bin, so without this the daemon's notify-panel / npm lookups
# (ensureNotifyPanel) would ENOENT. Quote it so colons/parens in the value are
# safe for the Environment= directive.
Environment="PATH=${process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin"}"

[Install]
WantedBy=default.target
`;

  writeFileSync(unitPath, unit);
  console.log(`✓ generated systemd user service: ${unitPath}`);

  if (opts.noStart) {
    console.log("\n(--no-start: not enabled. to enable manually:)");
    console.log(`  systemctl --user daemon-reload && systemctl --user enable --now ${SERVICE_NAME}`);
    return;
  }

  try {
    runSystemctl("daemon-reload");
    runSystemctl("enable", "--now", SERVICE_NAME);
    console.log("✓ enabled and started");
  } catch (e) {
    console.warn(`! auto-enable failed: ${(e as Error).message}`);
    console.log("  (common in containers/WSL without systemd. enable manually:)");
    console.log(`  systemctl --user daemon-reload && systemctl --user enable --now ${SERVICE_NAME}`);
    console.log(`  status: systemctl --user status ${SERVICE_NAME}`);
    return;
  }
  console.log("\nstatus / logs:");
  console.log(`  systemctl --user status ${SERVICE_NAME}`);
  console.log(`  journalctl --user -u ${SERVICE_NAME} -f`);
}

function uninstallSystemd(): void {
  const unitPath = join(homedir(), ".config", "systemd", "user", `${SERVICE_NAME}.service`);
  try {
    runSystemctl("disable", "--now", SERVICE_NAME);
    console.log(`✓ stopped and disabled ${SERVICE_NAME}`);
  } catch (e) {
    // Not installed / not running is fine; surface but continue to file removal.
    console.warn(`! disable step failed (was it installed?): ${(e as Error).message}`);
  }
  if (existsSync(unitPath)) {
    try {
      unlinkSync(unitPath);
      console.log(`✓ removed ${unitPath}`);
    } catch {
      /* ignore */
    }
  }
  try {
    runSystemctl("daemon-reload");
  } catch {
    /* best-effort */
  }
}

// ── launchd (macOS) ──────────────────────────────────────────────────

function installLaunchd(opts: ServiceOpts): void {
  const plistDir = join(homedir(), "Library", "LaunchAgents");
  const plistPath = join(plistDir, `${LAUNCHD_LABEL}.plist`);
  mkdirSync(plistDir, { recursive: true });

  const args = [opts.nodeBin, opts.cliBin, "listen", "--foreground", ...opts.extraArgs];
  const logFile = logFilePath();

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${escapeXml(a)}</string>`).join("\n")}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${escapeXml(logFile)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(logFile)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${escapeXml(homedir())}</string>
    <key>PATH</key><string>${escapeXml(process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin")}</string>
  </dict>
</dict>
</plist>
`;

  writeFileSync(plistPath, plist);
  console.log(`✓ generated launchd LaunchAgent: ${plistPath}`);

  if (opts.noStart) {
    console.log("\n(--no-start: not loaded. to load manually:)");
    console.log(`  launchctl load ${plistPath}`);
    return;
  }

  // unload first (a no-op on first install) so a re-install doesn't error.
  try {
    execFileSync("launchctl", ["unload", plistPath], { stdio: "ignore" });
  } catch {
    /* first install: nothing loaded yet */
  }
  try {
    execFileSync("launchctl", ["load", plistPath], { stdio: "inherit" });
    console.log("✓ loaded and started");
  } catch (e) {
    console.warn(`! auto-load failed: ${(e as Error).message}`);
    console.log("  load manually:");
    console.log(`  launchctl load ${plistPath}`);
    return;
  }
  console.log("\nstatus / uninstall:");
  console.log(`  launchctl list | grep ${LAUNCHD_LABEL}`);
  console.log(`  launchctl unload ${plistPath}`);
}

function uninstallLaunchd(): void {
  const plistPath = join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
  try {
    execFileSync("launchctl", ["unload", plistPath], { stdio: "ignore" });
    console.log(`✓ unloaded ${LAUNCHD_LABEL}`);
  } catch (e) {
    console.warn(`! unload failed (was it loaded?): ${(e as Error).message}`);
  }
  if (existsSync(plistPath)) {
    try {
      unlinkSync(plistPath);
      console.log(`✓ removed ${plistPath}`);
    } catch {
      /* ignore */
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────

/** Run `systemctl --user <args>`, inheriting stdio for visibility. */
function runSystemctl(...args: string[]): void {
  execFileSync("systemctl", ["--user", ...args], { stdio: "inherit" });
}

/**
 * Shell-quote a single argv piece for systemd's ExecStart. Bare alphanumerics
 * and a safe subset of punctuation pass through; everything else is wrapped in
 * single quotes (with embedded quotes escaped).
 */
function shellQuote(s: string): string {
  if (/^[A-Za-z0-9@%+=:,./_-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** XML-escape for launchd plist <string> values. */
function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
