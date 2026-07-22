// club info
//
// Display current session info and useful stats.

import { Command } from "commander";

import type { Participant, Room } from "@club/shared";

import { withAuthClient } from "../client-factory.js";
import { defaultRoom } from "../config.js";

export interface InfoDeps {
  /** Simulate `ClubClient.me()`. */
  me: () => Promise<Participant>;
  /** Simulate `ClubClient.rooms()`. */
  rooms: () => Promise<Room[]>;
  /** Simulate `ClubClient.members()`. */
  members: () => Promise<Participant[]>;
}

interface DisplayOpts {
  server: string;
  currentRoom: string;
}

/**
 * Print the participant identity, current room, all rooms with activity,
 * and the member roster.
 */
export async function runInfo(
  opts: DisplayOpts,
  deps: InfoDeps,
  now = Date.now(),
): Promise<void> {
  const [me, rooms, members] = await Promise.all([
    deps.me(),
    deps.rooms(),
    deps.members(),
  ]);

  console.log(`You: ${me.name} (id=${me.id})`);
  console.log(`Server: ${opts.server}`);
  console.log(`Current room: #${opts.currentRoom}`);
  console.log(`Total rooms: ${rooms.length}`);
  console.log(`Total members: ${members.length}`);

  console.log(`\nRooms:`);
  for (const r of rooms) {
    const active = r.lastActivityAt
      ? `active ${Math.floor((now - r.lastActivityAt) / 60000)}m ago`
      : "empty";
    const tag = r.slug === opts.currentRoom ? "*" : " ";
    console.log(` ${tag}#${r.slug} ${active}`);
  }

  console.log(`\nMembers:`);
  for (const m of members) {
    console.log(`  ${m.name}`);
  }
}

/**
 * Build the room-display label for a room slug. Returns "empty" when the
 * room has never seen a message, otherwise "active <N>m ago".
 */
export function roomDisplayLabel(room: Room, now = Date.now()): string {
  if (room.lastActivityAt == null) return "empty";
  return `active ${Math.floor((now - room.lastActivityAt) / 60000)}m ago`;
}

export function makeInfoCommand(): Command {
  return new Command("info")
    .description("show current session info")
    .action(withAuthClient(async (cfg, _args, client) => {
      // defaultRoom() falls back to "general" when the config room is unset;
      // this is the canonical current room for a fresh login.
      const currentRoom = defaultRoom(cfg);

      return runInfo(
        { server: cfg.server, currentRoom },
        {
          me: () => client.me(),
          rooms: () => client.rooms(),
          members: () => client.members(),
        },
      );
    }));
}
