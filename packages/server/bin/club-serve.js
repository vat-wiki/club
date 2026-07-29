#!/usr/bin/env node
// club-serve — run a full club (API + web UI + SQLite) with one command.
//
// Thin launcher. It ONLY configures the env vars that the compiled server
// (../dist/index.js) reads, then imports that server — which has import-time
// side effects (it calls serve() at module top level), so env MUST be set
// before the import.
//
// Data defaults to ~/.club/ (NOT the current working dir) so `npx club-serve`
// from a throwaway cwd doesn't drop club.db / uploaded files there. Dev
// (`npm -w club-serve run dev`), docker, and tests bypass this bin, so their
// existing ./club.db + ./files behaviour is unchanged.
//
// Priority: explicit flag > explicit env var > ~/.club default.

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const help = `club-serve — run a full club server (API + web UI + SQLite)

Usage:
  npx club-serve [options]

Options:
  --port <n>        Listen port (env PORT, default 6200)
  --host <addr>     Listen address (env HOST, default 0.0.0.0)
  --data-dir <path> Data directory for club.db + files (overrides ~/.club)
  -h, --help        Show this help

Data:
  By default club.db and uploaded files live under ~/.club/ so the current
  directory is not polluted. Override with --data-dir, or pin individual paths
  via the CLUB_DB / CLUB_FILES env vars.

Other env vars (all optional): ALLOWED_ORIGINS, TRUSTED_PROXY, CLUB_WEB_DIST,
  NODE_ENV.

Platform note:
  better-sqlite3 ships prebuilt binaries for glibc Linux and macOS. On
  Windows / arm64-Linux / musl (Alpine) prefer the Docker image.
`;

// Minimal, dependency-free flag parsing (commander belongs to club-cli, not here).
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === "-h" || arg === "--help") {
    process.stdout.write(help);
    process.exit(0);
  }
  const val = process.argv[i + 1];
  const need = (name) => {
    if (val === undefined) {
      console.error(`${name} requires a value`);
      process.exit(2);
    }
    return val;
  };
  switch (arg) {
    case "--port":
      process.env.PORT = need("--port");
      i++;
      break;
    case "--host":
      process.env.HOST = need("--host");
      i++;
      break;
    case "--data-dir": {
      const dir = resolve(need("--data-dir"));
      process.env.CLUB_DB = join(dir, "club.db");
      process.env.CLUB_FILES = join(dir, "files");
      i++;
      break;
    }
    default:
      console.error(`unknown option: ${arg}\nrun 'club-serve --help' for usage`);
      process.exit(2);
  }
}

// ~/.club default — only when nothing more specific already set it.
const dataDir = join(homedir(), ".club");
if (process.env.CLUB_DB === undefined) process.env.CLUB_DB = join(dataDir, "club.db");
if (process.env.CLUB_FILES === undefined) process.env.CLUB_FILES = join(dataDir, "files");

// Defensive: ensure the data dirs exist. db.ts also mkdirs its own parent, but
// this covers CLUB_FILES too and makes --data-dir Just Work regardless of the
// upload route's own mkdir timing.
mkdirSync(dirname(process.env.CLUB_DB), { recursive: true });
mkdirSync(process.env.CLUB_FILES, { recursive: true });

// Hand off to the compiled server — importing it starts listening (side effect).
await import("../dist/index.js");
