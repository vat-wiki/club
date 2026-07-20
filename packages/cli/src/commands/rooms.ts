// club rooms
//
// List every room (general first, then most-recently-active first — the server's
// GET /rooms ordering). The current/default room (from `club enter`, in config)
// is marked with ` *` so a user can see where their next `club send` lands.

import { Command } from "commander";

import { DEFAULT_ROOM, type Room } from "@club/shared";

import { withAuthClient } from "../client-factory.js";
import { defaultRoom } from "../config.js";

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
  const sys = room.slug === DEFAULT_ROOM ? " (system)" : "";
  return `#${room.slug}${marker}${sys}`;
}

export function makeRoomsCommand(): Command {
  return new Command("rooms")
    .description("list all rooms (current marked with *)")
    .action(withAuthClient(async (cfg, _args, client) => {
      const list = await client.rooms();
      const current = defaultRoom(cfg);
      for (const r of list) console.log(formatRoomLine(r, current));
      if (list.length === 0) console.log("(no rooms)");
    }));
}
