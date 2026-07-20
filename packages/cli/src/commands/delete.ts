// club delete <id>
//
// Delete (recall) a message. Only the author may delete their own messages.
// This is a soft-delete: the message stays in the database but is marked as
// deleted, and clients will show a "recalled" placeholder instead of the content.

import { Command } from "commander";
import { ClubClient } from "@club/sdk";
import { requireConfig } from "../config.js";
import { withCatchExit } from "../catch-exit.js";

export interface DeleteDeps {
  /** Simulate the SDK's `ClubClient.deleteMessage(id)` method. */
  deleteMessage: (id: string) => Promise<void>;
}

/**
 * Soft-delete (recall) a message.
 *
 * Dependency injection is used so the CLI can substitute a mocked
 * `deleteMessage()` in tests without requiring a real network connection.
 */
export async function runDelete(
  opts: { id: string },
  deps: DeleteDeps,
): Promise<void> {
  await deps.deleteMessage(opts.id.trim());
  console.log(`deleted ${opts.id}`);
}

export function makeDeleteCommand(): Command {
  return new Command("delete")
    .description("delete (recall) a message — only your own messages")
    .argument("<id>", "message ID to delete")
    .action(withCatchExit(async (id: string) => {
      const cfg = requireConfig();
      const client = new ClubClient(cfg);
      return runDelete({ id }, { deleteMessage: (i) => client.deleteMessage(i) });
    }));
}
