import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";

export interface ClubConfig {
  server: string;
  key: string;
  /** Current/default room slug written by `club enter`. Absent → "general".
   *  This is a client-side attention preference only; the server holds no
   *  per-participant default room (PRD §4.2 / §9.8). */
  room?: string;
}

// The system room — always exists, the default when no room is chosen. Exported
// so every call site that needs a fallback imports one constant (no magic
// string drift between send/read/listen/enter).
export const DEFAULT_ROOM = "general";

// Validates the on-disk config shape. server/key must be non-empty strings
// (they're credentials — a bad one must surface as "not logged in"). `room` is
// a preference, so it's accepted as any string (incl. empty) and normalized by
// defaultRoom() — a corrupt/empty room must NOT lock a logged-in user out.
const ConfigSchema = z.object({
  server: z.string().min(1),
  key: z.string().min(1),
  room: z.string().optional(),
});

/**
 * Resolve the effective default room for a config: the room `club enter` wrote,
 * falling back to "general" when unset, empty, or when there's no config at all.
 *
 * Pure + exported so the room-resolution rule (`--room` flag → config.room →
 * general) has one tested fallback step shared by send/read/listen.
 */
export function defaultRoom(cfg: { room?: string } | null): string {
  const r = cfg?.room?.trim();
  return r ? r : DEFAULT_ROOM;
}

// ~/.club/config.json by default; CLUB_CONFIG points elsewhere (used to run
// a human and an agent against the same server from one machine).
export function configPath(): string {
  if (process.env.CLUB_CONFIG) return resolve(process.env.CLUB_CONFIG);
  return join(homedir(), ".club", "config.json");
}

/**
 * Parse + validate a config file's raw contents. Returns null if the JSON is
 * malformed or lacks non-empty `server`/`key`, so a corrupted config is
 * surfaced as "not logged in" (clear, actionable) instead of producing
 * undefined fields that later crash as a cryptic "Invalid URL" / fetch error.
 * Pure and exported so it can be unit-tested without touching the filesystem.
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

export function requireConfig(): ClubConfig {
  const cfg = loadConfig();
  if (!cfg) {
    console.error("not logged in. run: club login <key>");
    process.exit(1);
  }
  return cfg;
}