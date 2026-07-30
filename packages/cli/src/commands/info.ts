// club info
//
// Display current session info and useful stats.

import { Command } from "commander";

import type { Channel,Participant } from "@club/shared";

import { withAuthClient } from "../client-factory.js";
import { defaultChannel } from "../config.js";

export interface InfoDeps {
  /** Simulate `ClubClient.me()`. */
  me: () => Promise<Participant>;
  /** Simulate `ClubClient.channels()`. */
  channels: () => Promise<Channel[]>;
  /** Simulate `ClubClient.members()`. */
  members: () => Promise<Participant[]>;
}

interface DisplayOpts {
  server: string;
  currentChannel: string;
}

/**
 * Print the participant identity, current channel, all channels with activity,
 * and the member roster.
 */
export async function runInfo(
  opts: DisplayOpts,
  deps: InfoDeps,
  now = Date.now(),
): Promise<void> {
  const [me, channels, members] = await Promise.all([
    deps.me(),
    deps.channels(),
    deps.members(),
  ]);

  console.log(`You: ${me.name} (id=${me.id})`);
  console.log(`Server: ${opts.server}`);
  console.log(`Current channel: #${opts.currentChannel}`);
  console.log(`Total channels: ${channels.length}`);
  console.log(`Total members: ${members.length}`);

  console.log(`\nChannels:`);
  for (const r of channels) {
    const active = r.lastActivityAt
      ? `active ${Math.floor((now - r.lastActivityAt) / 60000)}m ago`
      : "empty";
    const tag = r.slug === opts.currentChannel ? "*" : " ";
    console.log(` ${tag}#${r.slug} ${active}`);
  }

  console.log(`\nMembers:`);
  for (const m of members) {
    console.log(`  ${m.name}`);
  }
}

/**
 * Build the channel-display label for a channel slug. Returns "empty" when the
 * channel has never seen a message, otherwise "active <N>m ago".
 */
export function channelDisplayLabel(channel: Channel, now = Date.now()): string {
  if (channel.lastActivityAt == null) return "empty";
  return `active ${Math.floor((now - channel.lastActivityAt) / 60000)}m ago`;
}

export function makeInfoCommand(): Command {
  return new Command("info")
    .description("show current session info")
    .action(withAuthClient(async (cfg, _args, client) => {
      // defaultChannel() falls back to "general" when the config channel is unset;
      // this is the canonical current channel for a fresh login.
      const currentChannel = defaultChannel();

      return runInfo(
        { server: cfg.server, currentChannel },
        {
          me: () => client.me(),
          channels: () => client.channels(),
          members: () => client.members(),
        },
      );
    }));
}
