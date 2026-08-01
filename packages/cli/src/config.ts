import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { z } from "zod";

import { DEFAULT_CHANNEL } from "@club/shared";

export { DEFAULT_CHANNEL };

export interface ClubConfig {
  server: string;
  key: string;
}

// Validates the on-disk config shape. server/key must be non-empty strings.
// NOTE: a legacy `room` field (written by the removed `club enter` command,
// before the room->channel rename) is tolerated and stripped on load – there
// is no longer any notion of a "current/default channel" in config; commands
// always default to DEFAULT_CHANNEL unless `--channel` is given explicitly.
const ConfigSchema = z.object({
  server: z.string().min(1),
  key: z.string().min(1),
});

/**
 * The implicit default channel when no `--channel` is passed. Always `general`.
 * There is no longer a per-config "current channel" — pass `--channel` explicitly
 * to target anything else.
 */
export function defaultChannel(): string {
  return DEFAULT_CHANNEL;
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
  let raw: string;
  try {
    raw = readFileSync(p, "utf8");
  } catch {
    throw new ConfigError(
      `config file exists but could not be read: ${p}. run: club recover`,
    );
  }
  return parseConfig(raw);
}

export function saveConfig(cfg: ClubConfig): void {
  const p = configPath();
  if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

// Remove the config file, logging the caller out. Used after a self-delete
// (club delete-account): the account is gone, so the stored key is worthless
// and leaving it would make every subsequent command 401. No-op when the file
// is already absent so the caller doesn't have to pre-check.
export function clearConfig(): void {
  const p = configPath();
  if (existsSync(p)) unlinkSync(p);
}

// Like loadConfig but throws when not logged in. Used by commands that require auth.
export class ConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ConfigError";
  }
}

export function requireConfig(): ClubConfig {
  const p = configPath();
  const cfg = loadConfig();
  if (cfg) return cfg;
  // loadConfig returned null: either the file is missing (not logged in) or
  // it exists but failed schema validation (corrupted). Distinguish so a user
  // whose config is merely corrupted isn't told to re-login - that would
  // overwrite their stored key and lose their identity.
  if (existsSync(p)) {
    throw new ConfigError(`config file is corrupted: ${p}. run: club recover`);
  }
  throw new ConfigError("not logged in. run: club login <key>");
}