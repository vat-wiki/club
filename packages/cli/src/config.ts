import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { DEFAULT_ROOM } from "@club/shared";

export interface ClubConfig {
  server: string;
  key: string;
  /** Current/default room slug written by `club enter`. Absent → `DEFAULT_ROOM`. */
  room?: string;
}

// Validates the on-disk config shape. server/key must be non-empty strings.
const ConfigSchema = z.object({
  server: z.string().min(1),
  key: z.string().min(1),
  room: z.string().optional(),
});

/**
 * Resolve the effective default room for a config: the room `club enter` wrote,
 * falling back to `DEFAULT_ROOM` when unset.
 */
export function defaultRoom(cfg: { room?: string } | null): string {
  const r = cfg?.room?.trim();
  return r ?? DEFAULT_ROOM;
}

// ~/.club/config.json by default; CLUB_CONFIG points elsewhere.
export function configPath(): string {
  if (process.env.CLUB_CONFIG) return resolve(process.env.CLUB_CONFIG);
  return join(homedir(), ".club", "config.json");
}

/**
 * Parse + validate a config file's raw contents. Returns null if invalid.
 */
export function parseConfig(raw: string): ClubConfig | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = ConfigSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export function loadConfig(): ClubConfig | null {
  const p = configPath();
  if (!existsSync(p)) return null;
  return parseConfig(readFileSync(p, "utf8"));
}

export function saveConfig(cfg: ClubConfig): void {
  const p = configPath();
  if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

// Like loadConfig but throws when not logged in. Used by commands that require auth.
export class ConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ConfigError";
  }
}

export function requireConfig(): ClubConfig {
  const cfg = loadConfig();
  if (!cfg) throw new ConfigError("not logged in. run: club login <key>");
  return cfg;
}