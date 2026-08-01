// club edit <id> <text...>
//
// Edit one of your own messages. Mirrors delete/react: only the author may
// edit, and the server re-sanitizes + rejects empty/whitespace content. The
// refreshed Message (with editedAt) is printed via the shared formatter so the
// output matches `club read` / `club cat`. Errors (404 not yours / already
// recalled) propagate to the action's withCatchExit wrapper.

import { Command } from "commander";

import { ClubClient } from "@club/sdk";
import type { Message } from "@club/shared";

import { withCatchExit } from "../catch-exit.js";
import { requireConfig } from "../config.js";
import { formatMessage } from "./format.js";
import { readStream } from "../stdin.js";

export interface EditDeps {
  /** Simulate the SDK's `ClubClient.editMessage(id, content)` method. */
  editMessage: (id: string, content: string) => Promise<Message>;
  /** Format the refreshed message for stdout (shared with `read`). */
  formatMessage: (m: Message) => string;
}

export interface EditInput {
  /** Message id (whitespace-trimmed before the API call). */
  id: string;
  /** Already-resolved message content (stdin or joined argv), trimmed. */
  content: string;
}

/**
 * Edit one of your own messages and print the refreshed row.
 *
 * Dependency injection is used so the CLI can substitute a mocked
 * `editMessage()` / `formatMessage` in tests without a real network
 * connection.
 */
export async function runEdit(input: EditInput, deps: EditDeps): Promise<void> {
  const updated = await deps.editMessage(input.id.trim(), input.content);
  console.log(deps.formatMessage(updated));
}

/**
 * Build the `club edit` commander sub-command.
 *
 * Edits one of your own messages. Content is the joined `text...` args, or
 * read from stdin when piped / `--stdin` (same resolution as `club send`).
 * Only the author may edit; the server rejects empty/whitespace and 404s on
 * "not yours" / already-recalled messages.
 *
 * @returns A configured `Command` instance to register with the CLI program.
 */
export function makeEditCommand(): Command {
  return new Command("edit")
    .description("edit one of your own messages")
    .argument("<id>", "message ID to edit")
    .argument("[text...]", "new message text (omit if piping)")
    .option("--stdin", "read message body from stdin (auto-detected when piped)")
    .action(
      withCatchExit(
        async (
          id: string,
          text: string[],
          opts: { stdin?: boolean },
        ) => {
          // Auto-detect stdin: when no text args and stdin is piped, read it.
          // Explicit --stdin still works for clarity or testing. Mirrors send.
          const useStdin = opts.stdin ?? (!text.length && !process.stdin.isTTY);
          let content: string;
          if (useStdin) {
            content = await readStream(process.stdin);
          } else {
            content = text.join(" ");
          }
          content = content.trim();

          if (!content) {
            throw new Error("no message. pass text or use --stdin");
          }

          const cfg = requireConfig();
          const client = new ClubClient(cfg);
          return runEdit(
            { id, content },
            {
              editMessage: (i, c) => client.editMessage(i, c),
              formatMessage: (m) => formatMessage(m, { server: cfg.server }),
            },
          );
        },
      ),
    );
}
