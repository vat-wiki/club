// club info
//
// Display current session info and useful stats.

import { Command } from "commander";
import { ClubClient } from "@club/sdk";
import { defaultRoom, requireConfig } from "../config.js";

export function makeInfoCommand(): Command {
  return new Command("info")
    .description("show current session info")
    .action(async () => {
      const cfg = requireConfig();
      const client = new ClubClient(cfg);
      try {
        const [me, rooms, members] = await Promise.all([
          client.me(),
          client.rooms(),
          client.members(),
        ]);
        const room = defaultRoom(cfg);
        console.log(`You: ${me.name} (id=${me.id})`);
        console.log(`Server: ${cfg.server}`);
        console.log(`Current room: #${room}`);
        console.log(`Total rooms: ${rooms.length}`);
        console.log(`Total members: ${members.length}`);
        console.log(`\nRooms:`);
        for (const r of rooms) {
          const active = r.lastActivityAt
            ? `active ${Math.floor((Date.now() - r.lastActivityAt) / 60000)}m ago`
            : "empty";
          const tag = r.slug === room ? "*" : " ";
          console.log(` ${tag}#${r.slug} ${active}`);
        }
        console.log(`\nMembers:`);
        for (const m of members) {
          console.log(`  ${m.name}`);
        }
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    });
}
