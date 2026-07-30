// club channel <delete|rename> ...
//
// Open-CRUD channel actions:
//   club channel delete <slug>   — delete a channel and its messages (general protected)
//   club channel rename <slug> [name...] — set a channel's display name (slug stays)
//
// The slug is the immutable key; renaming edits the mutable display name only.
// Any authenticated participant may rename/delete any channel.

import { Command } from "commander";

import { ClubClient } from "@club/sdk";

import { withCatchExit } from "../catch-exit.js";
import { requireConfig } from "../config.js";

export interface ChannelDeleteDeps {
  /** Simulate the SDK's `ClubClient.deleteChannel(slug)` method. */
  deleteChannel: (slug: string) => Promise<void>;
}
export interface ChannelRenameDeps {
  /** Simulate the SDK's `ClubClient.updateChannel(slug, displayName)` method. */
  updateChannel: (slug: string, displayName: string | null) => Promise<unknown>;
}

/** Delete a channel. Dependency-injected for tests. */
export async function runChannelDelete(
  opts: { slug: string },
  deps: ChannelDeleteDeps,
): Promise<void> {
  await deps.deleteChannel(opts.slug.trim());
  console.log(`deleted #${opts.slug}`);
}

/** Rename a channel (display name; slug immutable). `null`/empty clears it. */
export async function runChannelRename(
  opts: { slug: string; displayName: string | null },
  deps: ChannelRenameDeps,
): Promise<void> {
  await deps.updateChannel(opts.slug.trim(), opts.displayName);
  console.log(
    opts.displayName ? `renamed #${opts.slug} → ${opts.displayName}` : `cleared name for #${opts.slug}`,
  );
}

/**
 * Build the `club channel` commander sub-command group (delete, rename).
 *
 * @returns A configured `Command` instance to register with the CLI program.
 */
export function makeChannelCommand(): Command {
  const cmd = new Command("channel").description(
    "channel actions: delete <slug>, rename <slug> [name...]",
  );

  cmd.command("delete")
    .description("delete a channel and its messages (general is protected)")
    .argument("<slug>", "channel slug")
    .action(
      withCatchExit(async (slug: string) => {
        const cfg = requireConfig();
        const client = new ClubClient(cfg);
        return runChannelDelete({ slug }, { deleteChannel: (s) => client.deleteChannel(s) });
      }),
    );

  cmd.command("rename")
    .description("set a channel's display name (slug stays; blank to clear)")
    .argument("<slug>", "channel slug")
    .argument("[name...]", "display name (blank to clear)")
    .action(
      withCatchExit(async (slug: string, name: string[] = []) => {
        const cfg = requireConfig();
        const client = new ClubClient(cfg);
        const display = name.join(" ").trim();
        return runChannelRename(
          { slug, displayName: display === "" ? null : display },
          { updateChannel: (s, d) => client.updateChannel(s, d) },
        );
      }),
    );

  return cmd;
}
