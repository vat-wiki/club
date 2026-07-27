// club listen [flags]
//
// Follow the live SSE stream and forward every matching message into the local
// notify-panel inbox. club CLI no longer prints messages to stdout — the inbox
// is the single place an agent "checks → acts". Without flags it forwards every
// message across all rooms; with --mention <name> it filters to messages that
// @-mention the target.
//
// ── Run modes ────────────────────────────────────────────────────────
//
// The default is a long-running FOREGROUND forwarder: stays attached to the SSE
// stream and keeps pushing until killed (SIGINT/SIGTERM). `--once` is kept for
// back-compat with old "exit-on-first-match wake-up" cron scripts.
//
// To keep the forwarder running without holding a terminal, use the daemon /
// system-service modes — they all run the *same* foreground core under a
// supervisor, so the forwarding logic lives in exactly one place:
//
//   club listen --daemon        spawn the foreground core detached, write a
//                               PID + log under ~/.club/, return immediately.
//                               Survives terminal close, NOT reboot/crash.
//   club listen --install       register a system service (systemd user unit on
//                               Linux, launchd LaunchAgent on macOS) that runs
//                               `club listen --foreground` with Restart=on-failure
//                               and WantedBy=default.target. Survives reboot +
//                               crash. Requires `club login` first (config.json
//                               must exist or the service crash-loops).
//   club listen --uninstall     remove that system service.
//   club listen --stop          stop a running --daemon process (PID file).
//   club listen --status        is a listen daemon alive right now?
//   club listen --logs [n]      tail the daemon log (default 50 lines).
//
// Why a dedicated --install command (not an npm postinstall hook): registration
// needs config.json to already exist, runs platform system tooling that is
// unreliable in npm's non-interactive context, and is a side effect users must
// opt into. See src/listen-install.ts.
//
// Severity: a message is `warning` if it @-mentions us (our own name, resolved
// via GET /me — not the --mention filter, which may differ), else `info`.
//
// notify-panel is a mandatory base dependency; ensureNotifyPanel() guarantees it
// is installed + running before this command's action fires.

import { spawn } from "node:child_process";

import { Command } from "commander";

import { ClubClient } from "@club/sdk";
import { mentionMatches, type Message } from "@club/shared";

import { withCatchExit } from "../catch-exit.js";
import { loadConfig, requireConfig } from "../config.js";
import { ensureNotifyPanel } from "../ensure-notify-panel.js";
import {
  installService,
  type ServiceOpts,
  serviceStatus,
  serviceStop,
  uninstallService,
} from "../listen-install.js";
import {
  appendLogBanner,
  clearPidFile,
  isAlive,
  logFilePath,
  readPidFile,
  resolveClubBin,
  tailLog,
  writePidFile,
} from "../listen-runtime.js";
import { type PushInput, pushMessage } from "../notify.js";

/**
 * Whether a streamed message should be forwarded to the notify-panel inbox.
 *
 * Two filters, short-circuiting on the first that excludes it:
 * 1. **Self-skip**: if we know our own participant id, never forward our own
 *    messages — otherwise every `club send` we do echoes right back into the
 *    inbox as if it were an incoming message. An agent reading its own outgoing
 *    message is noise, not a trigger to act.
 * 2. **Mention filter**: when `--mention <name>` is set, only messages that
 *    @-mention that name pass.
 *
 * `meId` is `undefined` when `GET /me` failed; in that case self-skip is
 * disabled (worst case we echo, which is safer than dropping a real incoming
 * message).
 *
 * @returns true if the message should be pushed to the inbox.
 */
export function shouldForwardMessage(
  m: Message,
  opts: { meId?: string; mention?: string } = {},
): boolean {
  if (opts.meId && m.participantId === opts.meId) return false;
  if (opts.mention && !mentionMatches(m.content, opts.mention)) return false;
  return true;
}

/** Flags shared by every run mode that drives the foreground core. */
interface ListenFlags {
  mention?: string;
  room?: string;
  once?: boolean;
}

/**
 * The single source of truth for "follow the SSE stream and forward to the
 * inbox". Called by the default foreground action AND by the `--foreground`
 * child that `--daemon`/`--install` spawn — so all run modes share one
 * forwarding implementation.
 *
 * Connects, resolves /me, subscribes, installs SIGINT/SIGTERM handlers, and
 * then blocks forever (the stream needs an unsettled macrotask to keep Node
 * alive). Returns only via signal-driven process.exit.
 */
async function runListenForeground(flags: ListenFlags): Promise<void> {
  const cfg = requireConfig();
  const mention = flags.mention;
  const once = flags.once ?? false;
  const client = new ClubClient(cfg);

  // Base dependency gate: notify-panel must be installed + reachable.
  const conn: PushInput | null = await ensureNotifyPanel();
  if (!conn) {
    throw new Error(
      "notify-panel is required but not available; run: npm i -g notify-panel && notify-panel start",
    );
  }

  // Resolve our own id + name. id lets us skip echoing our own outgoing
  // messages (see shouldForwardMessage); name drives severity
  // (mention → warning). Best-effort: if /me fails we fall back to the
  // --mention filter for severity, and disable self-skip — severity then
  // degrades to `info`, which is safe.
  let meId: string | undefined;
  let meName: string | undefined;
  try {
    const me = await client.me();
    meId = me.id;
    meName = me.name;
  } catch {
    meName = mention;
  }

  const reportThinking = (m: Message) => {
    if (!mention || !mentionMatches(m.content, mention)) return;
    // Best-effort: a transient thinking-report failure should never
    // interrupt the live forwarder; swallow silently.
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- intentional best-effort swallow
    void client.reportAgentThinking(m.room).catch(() => {});
  };

  let stopping = false;
  const stop = (sub: { stop: () => void }) => {
    if (stopping) return;
    stopping = true;
    sub.stop();
  };

  const sub = client.stream(
    async (m: Message) => {
      if (!shouldForwardMessage(m, { meId, mention })) return;
      reportThinking(m);
      // In --once mode we MUST await the push before exiting, or the
      // process dies before the HTTP request lands. In stream mode we
      // fire-and-forget but warn on failure — unlike `mentions`, a live
      // stream can't fall back on a server-side unread queue to retry,
      // so a dropped push is a dropped message; at least make it visible.
      if (once) {
        const ok = await pushMessage(m, conn, { meName });
        if (!ok) {
          process.stderr.write(
            `club: failed to forward message ${m.id} to notify-panel; exiting anyway (--once).\n`,
          );
        }
        stop(sub);
        process.exit(0);
      } else {
        void pushMessage(m, conn, { meName }).then((ok) => {
          if (!ok) {
            process.stderr.write(
              `club: failed to forward message ${m.id} to notify-panel (message lost from live stream).\n`,
            );
          }
        });
      }
    },
    flags.room ? { room: flags.room } : {},
  );

  const onSignal = () => {
    stop(sub);
    process.exit(0);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  // Keep the process alive for the stream callbacks; the stream itself
  // holds the connection but Node needs an unsettled macrotask to stay up.
  // The executor is intentionally empty (never resolves).
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- intentional never-resolving keep-alive
  await new Promise<never>(() => {});
}

/**
 * Re-spawn the current CLI as a detached background daemon running the
 * foreground core. Writes the child's PID and a banner to ~/.club/, then
 * detaches so the parent can exit immediately. The child inherits a redirected
 * log fd in place of stdout/stderr.
 *
 * Only one instance is allowed: if a live PID is already on disk, refuse.
 */
function startDaemon(flags: ListenFlags): void {
  const existing = readPidFile();
  if (existing && isAlive(existing)) {
    console.error(`club: listen daemon already running (pid ${existing}).`);
    console.error("  stop it first: club listen --stop");
    process.exit(1);
  }
  // Stale PID file from a crashed run — clear it before we start fresh.
  if (existing) clearPidFile();

  const cliBin = resolveClubBin();
  if (!cliBin) {
    console.error("club: could not resolve the club CLI path for daemon spawn.");
    process.exit(1);
  }

  const args = [cliBin, "listen", "--foreground"];
  if (flags.mention) args.push("--mention", flags.mention);
  if (flags.room) args.push("--room", flags.room);

  appendLogBanner(`\n\n===== club listen daemon started ${new Date().toISOString()} =====\n`);

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, CLUB_DAEMONIZED: "1" },
  });

  // Write the PID immediately so --status/--stop work right away. If spawn
  // failed the pid would be undefined and we'd surface that below.
  if (child.pid) writePidFile(child.pid);
  child.unref();

  child.on("error", (err) => {
    // Detached spawn errors are rare (binary missing, etc.) but we must not
    // leave the user with no clue + a stale PID file.
    console.error(`club: failed to start listen daemon: ${err.message}`);
    clearPidFile();
    process.exit(1);
  });

  // Give the child a beat to confirm it didn't immediately die. detached +
  // unref'd children can't be awaited for exit, but an `error` event on the
  // same tick covers the spawn-level failures.
  console.log(`club: listen daemon started (pid ${child.pid}).`);
  console.log(`  log: ${logFilePath()}`);
  console.log("  stop: club listen --stop");
}

/**
 * Stop the listen daemon. Prefers the system-service backend (the authoritative
 * supervisor when --install was used); falls back to the PID file for a
 * --daemon spawn. The two are mutually exclusive in practice: --install
 * supervises via the service manager, --daemon is the manual, PID-file mode.
 */
function stopDaemon(): void {
  // Try the system service first: it's the supervisor that actually owns a
  // long-running daemon. serviceStop() returns false only when there's no
  // backend/tooling, in which case we fall through to the PID file.
  const stopped = serviceStop();
  if (stopped) {
    console.log("club: stopped the club-listen system service.");
    // A leftover PID file from a pre-install --daemon run is harmless to clear.
    clearPidFile();
    return;
  }
  const pid = readPidFile();
  if (!pid) {
    console.log("club: no listen daemon running (no system service, no PID file).");
    return;
  }
  if (!isAlive(pid)) {
    console.log(`club: PID file pointed at ${pid} but it isn't running (stale).`);
    clearPidFile();
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
    console.log(`club: sent SIGTERM to listen daemon (pid ${pid}).`);
    clearPidFile();
  } catch (e) {
    console.error(`club: could not stop daemon ${pid}: ${(e as Error).message}`);
    process.exit(1);
  }
}

/**
 * Print whether a listen daemon is currently alive. Checks the system service
 * first (authoritative), then a --daemon PID file. Exit 0/1 accordingly so
 * this doubles as a scriptable probe.
 */
function statusDaemon(): void {
  const svc = serviceStatus();
  if (svc) {
    console.log("club: listen daemon is running (via system service).");
    process.exit(0);
  }
  const pid = readPidFile();
  if (pid && isAlive(pid)) {
    console.log(`club: listen daemon is running (pid ${pid}, --daemon).`);
    process.exit(0);
  }
  if (pid) {
    console.log(`club: listen daemon is NOT running (stale PID file, was ${pid}).`);
    clearPidFile();
  } else {
    console.log("club: listen daemon is not running.");
  }
  process.exit(1);
}

/** Tail the daemon log (default 50 lines). */
function logsDaemon(lines: number): void {
  console.log(tailLog(lines));
}

/**
 * Register the system service. Refuses without a logged-in config, because a
 * service started without config.json crash-loops (requireConfig throws).
 */
function installDaemonService(flags: ListenFlags & { noStart?: boolean }): void {
  // Guard: a service without login credentials would restart-loop. Check
  // config existence WITHOUT requireConfig's throw so we can print guidance.
  const cfg = loadConfig();
  if (!cfg) {
    console.error("club: not logged in. run `club login <key>` before --install,");
    console.error("      otherwise the service will crash-loop on missing config.");
    process.exit(1);
  }

  const cliBin = resolveClubBin();
  if (!cliBin) {
    console.error("club: could not resolve the club CLI path for the service unit.");
    process.exit(1);
  }

  const extraArgs: string[] = [];
  if (flags.mention) extraArgs.push("--mention", flags.mention);
  if (flags.room) extraArgs.push("--room", flags.room);

  const opts: ServiceOpts = {
    nodeBin: process.execPath,
    cliBin,
    extraArgs,
    noStart: flags.noStart,
  };
  installService(opts);
}

/** Uninstall the system service. */
function uninstallDaemonService(): void {
  uninstallService();
}

/**
 * Build the `club listen` commander sub-command.
 *
 * Default action follows the live stream in the foreground. Flags select
 * alternate run modes (daemon, system-service install, stop, status, logs);
 * see the module header for the full matrix.
 *
 * @returns A configured `Command` instance to register with the CLI program.
 */
export function makeListenCommand(): Command {
  return new Command("listen")
    .description("forward the live stream into your notify-panel inbox")
    .option("--mention <name>", "only forward messages that @<name>")
    .option(
      "--room <slug>",
      "listen to one room only (default: all rooms — a mention in any room is forwarded)",
    )
    .option(
      "--once",
      "exit 0 after the first forwarded message (back-compat wake-up mode; default: stream forever)",
    )
    .option("--daemon", "run detached in the background (survives terminal close)")
    .option(
      "--foreground",
      "(internal) run the forwarding core in the foreground — used by --daemon and the system service",
    )
    .option("--install", "register a system service for boot-start + auto-restart")
    .option("--uninstall", "remove the system service")
    .option("--stop", "stop a running --daemon process")
    .option("--status", "is a listen daemon running right now?")
    .option("--logs [lines]", "tail the daemon log (default 50 lines)")
    .option("--no-start", "with --install: generate the service but don't enable it")
    .action(
      withCatchExit(
        (opts: ListenFlags & {
          daemon?: boolean;
          foreground?: boolean;
          install?: boolean;
          uninstall?: boolean;
          stop?: boolean;
          status?: boolean;
          logs?: boolean | string;
          start?: boolean;
        }) => {
          // Mode dispatch. --install/--uninstall/--stop/--status/--logs are
          // terminal actions: they do their thing and exit (via process.exit
          // or by returning). --daemon spawns and returns. --foreground and
          // the default both fall through to runListenForeground.
          if (opts.uninstall) return uninstallDaemonService();
          if (opts.install) return installDaemonService(opts);
          if (opts.stop) return stopDaemon();
          if (opts.status) return statusDaemon();
          if (opts.logs !== undefined) {
            const n =
              typeof opts.logs === "string" ? Number(opts.logs) || 50 : 50;
            return logsDaemon(n);
          }
          if (opts.daemon) return startDaemon(opts);
          // Default + --foreground share the core.
          return runListenForeground(opts);
        },
      ),
    );
}
