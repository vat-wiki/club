import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

export interface ClubConfig {
  server: string;
  key: string;
}

// ~/.club/config.json by default; CLUB_CONFIG points elsewhere (used to run
// a human and an agent against the same server from one machine).
function configPath(): string {
  if (process.env.CLUB_CONFIG) return resolve(process.env.CLUB_CONFIG);
  return join(homedir(), ".club", "config.json");
}

export function loadConfig(): ClubConfig | null {
  const p = configPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as ClubConfig;
  } catch {
    return null;
  }
}

export function saveConfig(cfg: ClubConfig): void {
  const p = configPath();
  if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

export function requireConfig(): ClubConfig {
  const cfg = loadConfig();
  if (!cfg) {
    console.error("not logged in. run: club login <key>");
    process.exit(1);
  }
  return cfg;
}