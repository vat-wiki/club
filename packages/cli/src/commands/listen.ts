import { Command } from "commander";
import { ClubClient } from "@club/sdk";
import { mentionMatches, type Message } from "@club/shared";
import { requireConfig } from "../config.js";
import { formatMessage } from "./format.js";

export function makeListenCommand(): Command {
  return new Command("listen")
    .description("follow the live stream; optionally block until someone @mentions you")
    .option("--mention <name>", "print+exit when a message @<name> appears")
    .option("--once", "with --mention, exit after the first match (default true)")
    .option(
      "--room <slug>",
      "listen to one room only (default: all rooms — a mention in any room wakes you)",
    )
    .action(async (opts: { mention?: string; once?: boolean; room?: string }) => {
      const cfg = requireConfig();
      const mention = opts.mention;
      const once = opts.once ?? true; // default: exit on first @
      const client = new ClubClient(cfg);
      // --room scopes the SSE stream to one room; omit to receive all rooms.
      // The global default is intentional (PRD §5.5): a mention in ANY room
      // wakes the listener, so an agent挂在 general still hears a cross-room @.
      const streamOpts = opts.room ? { room: opts.room } : {};

      // P1-5: when an agent is woken by a @mention, light up the room's typing
      // indicator so humans see the agent picked it up. Reported exactly once,
      // right before the matched message is printed (the moment the agent
      // "starts handling" it). Scoped to the listened room when --room is set,
      // so the indicator lands in the room the mention came from. The server
      // auto-clears it when this agent later POSTs a reply; if never, the TTL
      // reaper clears it. Swallowed — the indicator is a nicety, not correctness,
      // and a human key legitimately 404s here.
      const reportThinking = (m: Message) => {
        if (!mention || !mentionMatches(m.content, mention)) return;
        // m.room is where the mention actually happened — scope the indicator
        // there so a focused stream sees it (matches the mention's room).
        void client.reportAgentThinking(m.room).catch(() => {});
      };

      const sub = client.stream(
        (m: Message) => {
          // Skip until someone @-mentions `mention`. Matching is shared with the
          // server inbox and MCP via @club/shared mentionMatches (word-boundary),
          // so a live listen catches exactly what the offline inbox would deliver.
          if (mention && !mentionMatches(m.content, mention)) return;
          reportThinking(m);
          console.log(formatMessage(m));
          if (mention && once) {
            sub.stop();
            process.exit(0);
          }
        },
        streamOpts,
      );

      // Without --mention, stream forever (until Ctrl-C).
      process.on("SIGINT", () => {
        sub.stop();
        process.exit(0);
      });
    });
}
