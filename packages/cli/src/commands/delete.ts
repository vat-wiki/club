// club delete <id>
//
// Delete (recall) a message. Only the author may delete their own messages.
// This is a soft-delete: the message stays in the database but is marked as
// deleted, and clients will show a "recalled" placeholder instead of the content.

import { Command } from "commander";
import { ClubClient } from "@club/sdk";
import { requireConfig } from "../config.js";

export function makeDeleteCommand(): Command {
  return new Command("delete")
    .description("delete (recall) a message — only your own messages")
    .argument("<id>", "message ID to delete")
    .action(async (id: string) => {
      const cfg = requireConfig();
      const client = new ClubClient(cfg);
      await client.deleteMessage(id.trim());
      console.log(`deleted ${id}`);
    });
}
