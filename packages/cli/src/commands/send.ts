import { Command } from "commander";
import { ClubClient } from "@club/sdk";
import { uploadImageFile } from "@club/sdk/node";
import { requireConfig } from "../config.js";
import { readStream, type ReadableLike } from "../stdin.js";
import { runSend, type SendDeps } from "./send-impl.js";

export function makeSendCommand(): Command {
  return new Command("send")
    .description(
      'send a message — `club send "hi"`, `echo hi | club send --stdin`, or attach images with `--image <path>` (repeatable, ≤8)',
    )
    .argument("[text...]", "message text (omit if piping via --stdin or sending images only)")
    .option("--stdin", "read message body from stdin")
    .option(
      "--image <path>",
      "attach an image file (png/jpeg/gif/webp, ≤10MB); repeatable up to 8 times",
      // Collect repeated --image flags into an array.
      (v: string, acc: string[]) => [...acc, v],
      [] as string[],
    )
    .action(async (text: string[], opts: { stdin?: boolean; image?: string[] }) => {
      let content: string;
      if (opts.stdin) {
        // process.stdin has isTTY/setEncoding/on at runtime; the narrow
        // ReadableLike interface is just for testability, so assert the shape.
        content = await readStream(process.stdin as unknown as ReadableLike);
      } else {
        content = text.join(" ");
      }
      content = content.trim();

      const cfg = requireConfig();
      const client = new ClubClient(cfg);
      // Wire the real SDK functions; runSend holds the testable orchestration.
      const deps: SendDeps = {
        uploadImage: (conn, p) => uploadImageFile(conn, p),
        send: (c, ids) => client.send(c, ids),
      };
      try {
        await runSend({ content, images: opts.image ?? [], conn: cfg }, deps);
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    });
}
