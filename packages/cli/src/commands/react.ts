// club react <id> <emoji>
//
// Add or remove a reaction emoji on a message. If the emoji is already present
// (by you), it removes it; otherwise adds it. The reaction aggregate is
// broadcast to all clients in real-time.

import { Command } from "commander";
import { ClubClient } from "@club/sdk";
import { requireConfig } from "../config.js";

export function makeReactCommand(): Command {
  return new Command("react")
    .description("add or remove a reaction emoji on a message")
    .argument("<id>", "message ID to react to")
    .argument("<emoji>", "emoji to react with (e.g. 👍, 🎉, ❤️)")
    .action(async (id: string, emoji: string) => {
      const cfg = requireConfig();
      const client = new ClubClient(cfg);
      const reactions = await client.toggleReaction(id.trim(), emoji.trim());
      const updated = reactions.map((r) => `${r.emoji}(${r.count})`).join(" ");
      console.log(`${id} reactions: ${updated || "(none)"}`);
    });
}
