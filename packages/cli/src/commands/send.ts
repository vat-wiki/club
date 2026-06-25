import { Command } from "commander";
import { ClubClient } from "@club/sdk";
import { requireConfig } from "../config.js";
import { readStream, type ReadableLike } from "../stdin.js";

export function makeSendCommand(): Command {
  return new Command("send")
    .description('send a message — `club send "hi"` or `echo hi | club send --stdin`')
    .argument("[text...]", "message text (omit if piping via --stdin)")
    .option("--stdin", "read message body from stdin")
    .action(async (text: string[], opts: { stdin?: boolean }) => {
      let content: string;
      if (opts.stdin) {
        // process.stdin has isTTY/setEncoding/on at runtime; the narrow
        // ReadableLike interface is just for testability, so assert the shape.
        content = await readStream(process.stdin as unknown as ReadableLike);
      } else {
        if (text.length === 0) {
          console.error("no message. pass text or use --stdin");
          process.exit(1);
        }
        content = text.join(" ");
      }
      content = content.trim();
      if (!content) {
        console.error("empty message");
        process.exit(1);
      }
      const cfg = requireConfig();
      try {
        await new ClubClient(cfg).send(content);
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    });
}
