// club enter <room>
//
// Switch the client's current/default room: writes the room into config so the
// next `club send` / `club read` (without --room) targets it. Per PRD §4.5 /
// §9.4, building and entering are the SAME action in the open model — entering
// a room ensures it exists (POST /rooms is idempotent, returns the pre-existing
// room if it already does). The verb is `enter`, NOT `join` — `join <name>` is
// the onboarding-only verb (issues.md #003, pinned).
//
// The room slug is validated client-side (shared ROOM_SLUG_REGEX) so a typo is
// caught before any network call, with a clear message rather than the server's
// generic 400.

import { Command } from "commander";
import { ClubClient } from "@club/sdk";
import { ROOM_SLUG_REGEX, type Room } from "@club/shared";
import { requireConfig, saveConfig, type ClubConfig } from "../config.js";

export interface EnterDeps {
  /** Ensure a room exists (idempotent create). Throws on HTTP failure. */
  createRoom: (name: string) => Promise<Room>;
  /** Persist the updated config (honors CLUB_CONFIG). */
  saveConfig: (cfg: ClubConfig) => void;
}

export interface EnterInput {
  room: string;
  /** Current config (server+key, maybe a prior room) — preserved on save. */
  config: ClubConfig;
}

export interface EnterResult {
  room: Room;
}

/**
 * Validate the slug, ensure the room exists, and write it as the default room.
 * Extracted as a pure-ish function (deps injected) so it can be unit-tested
 * without commander or a real server. Throws on an invalid slug or a failed
 * create; the caller surfaces the message.
 */
export async function runEnter(input: EnterInput, deps: EnterDeps): Promise<EnterResult> {
  const slug = input.room.trim();
  if (!ROOM_SLUG_REGEX.test(slug)) {
    throw new Error(
      `invalid room name "${input.room}" — must be 1-30 chars of [a-z0-9-], starting alphanumeric`,
    );
  }
  // Build/enter are the same action: ensure the room exists. Idempotent — an
  // existing slug returns that room without error (PRD §4.5).
  const room = await deps.createRoom(slug);
  // Preserve server+key; only the room preference changes.
  deps.saveConfig({ ...input.config, room: room.slug });
  return { room };
}

export function makeEnterCommand(): Command {
  return new Command("enter")
    .description("switch to a room — sets it as the default for send/read (creates it if new)")
    .argument("<room>", "room slug (1-30 chars [a-z0-9-])")
    .action(async (room: string) => {
      const cfg = requireConfig();
      const client = new ClubClient(cfg);
      try {
        const { room: r } = await runEnter(
          { room, config: cfg },
          { createRoom: (n) => client.createRoom(n), saveConfig },
        );
        console.log(`entered #${r.slug}`);
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    });
}
