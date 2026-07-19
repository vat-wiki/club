// club rooms
//
// List every room (general first, then most-recently-active first — the server's
// GET /rooms ordering). The current/default room (from `club enter`, in config)
// is marked with ` *` so a user can see where their next `club send` lands.

import { Command } from "commander";
import { ClubClient } from "@club/sdk";
import type { Room } from "@club/shared";
import { defaultRoom, requireConfig } from "../config.js";
import { withCatchExit } from "../catch-exit.js";

/**
 * Render one room line. Pure so the marker rule (current → ` *`, general system
 * tag) can be unit-tested without a server.
 *
 *   #general * (system)   ← current is general
 *   #deploy-debug *       ← current is a custom room
 *   #internal             ← not current
 */
export function formatRoomLine(room: Room, current: string): string {
  const marker = room.slug === current ? " *" : "";
  const sys = room.slug === "general" ? " (system)" : "";
  return `#${room.slug}${marker}${sys}`;
}

export function makeRoomsCommand(): Command {
  return new Command("rooms")
    .description("list all rooms (current marked with *)")
    .action(withCatchExit(async () => {
      const cfg = requireConfig();
      const list = await new ClubClient(cfg).rooms();
      const current = defaultRoom(cfg);
      for (const r of list) console.log(formatRoomLine(r, current));
      if (list.length === 0) console.log("(no rooms)");
    }));
}
