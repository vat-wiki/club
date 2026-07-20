// club react <id> <emoji>
//
// Add or remove a reaction emoji on a message. If the emoji is already present
// (by you), it removes it; otherwise adds it. The reaction aggregate is
// broadcast to all clients in real-time.

import { Command } from "commander";

import { ClubClient } from "@club/sdk";
import type { Reaction } from "@club/shared";

import { withCatchExit } from "../catch-exit.js";
import { requireConfig } from "../config.js";

/**
 * Strip ASCII control characters from an emoji string.
 *
 * Prevents CRLF injection, NUL/DEL leakage, and invisible character pollution
 * in the reaction stream. The server also strips these, but a clean client is
 * better hygiene.
 */
export function sanitizeEmoji(raw: string): string {
  return raw.replace(/[\x00-\x1f\x7f]/g, "");
}

export interface ReactDeps {
  /** Simulate the server's `toggleReaction` method. */
  toggleReaction: (id: string, emoji: string) => Promise<Reaction[]>;
}

export async function runReact(
  opts: { id: string; emoji: string },
  deps: ReactDeps,
): Promise<void> {
  const cleanEmoji = sanitizeEmoji(opts.emoji);
  const reactions = await deps.toggleReaction(opts.id.trim(), cleanEmoji.trim());
  const updated = reactions.map((r) => `${r.emoji}(${r.count})`).join(" ");
  console.log(`${opts.id} reactions: ${updated || "(none)"}`);
}

export function makeReactCommand(): Command {
  return new Command("react")
    .description("add or remove a reaction emoji on a message")
    .argument("<id>", "message ID to react to")
    .argument("<emoji>", "emoji to react with (e.g. 👍, 🎉, ❤️)")
    .action(withCatchExit(async (id: string, emoji: string) => {
      const cfg = requireConfig();
      const client = new ClubClient(cfg);
      return runReact(
        { id, emoji },
        {
          toggleReaction: (msgId: string, e: string) => client.toggleReaction(msgId, e),
        },
      );
    }));
}
