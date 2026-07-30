// club channels
//
// List every channel (general first, then most-recently-active first — the server's
// GET /channels ordering). The current/default channel (from `club enter`, in config)
// is marked with ` *` so a user can see where their next `club send` lands.

import { Command } from "commander";

import { type Channel,DEFAULT_CHANNEL } from "@club/shared";

import { withAuthClient } from "../client-factory.js";
import { defaultChannel } from "../config.js";

/**
 * Render one channel line. Pure so the marker rule (current → ` *`, general system
 * tag) can be unit-tested without a server.
 *
 *   #general * (system)   ← current is general
 *   #deploy-debug *       ← current is a custom channel
 *   #internal             ← not current
 */
export function formatChannelLine(channel: Channel, current: string): string {
  const marker = channel.slug === current ? " *" : "";
  const sys = channel.slug === DEFAULT_CHANNEL ? " (system)" : "";
  return `#${channel.slug}${marker}${sys}`;
}

/**
 * Build the `club channels` commander sub-command.
 *
 * Lists every channel (general first, then most-recently-active — the server's
 * GET /channels ordering). The default channel (general) is marked with ` *` so
 * the user sees where a `club send` without `-r` lands.
 *
 * @returns A configured `Command` instance to register with the CLI program.
 */
export function makeChannelsCommand(): Command {
  return new Command("channels")
    .description("list all channels (default channel marked with *)")
    .action(withAuthClient(async (_cfg, _args, client) => {
      const list = await client.channels();
      const current = defaultChannel();
      for (const r of list) console.log(formatChannelLine(r, current));
      if (list.length === 0) console.log("(no channels)");
    }));
}
