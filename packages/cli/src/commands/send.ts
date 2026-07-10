import { Command } from "commander";
import { ClubClient } from "@club/sdk";
import { uploadImageFile, uploadVideoFile, uploadDocumentFile } from "@club/sdk/node";
import { requireConfig } from "../config.js";
import { readStream, type ReadableLike } from "../stdin.js";
import { runSend, type SendDeps } from "./send-impl.js";

// Collect repeated --image / --video / --file flags into an array (commander coercion).
const collect = (v: string, acc: string[]): string[] => [...acc, v];

export function makeSendCommand(): Command {
  return new Command("send")
    .description(
      'send a message — `club send "hi"`, `echo hi | club send --stdin`, or attach files with `--image` / `--video` / `--file <path>` (repeatable, ≤8 total)',
    )
    .argument("[text...]", "message text (omit if piping via --stdin or sending files only)")
    .option("--stdin", "read message body from stdin")
    .option(
      "--image <path>",
      "attach an image (png/jpeg/gif/webp, ≤10MB); repeatable up to 8 total",
      collect,
      [] as string[],
    )
    .option(
      "--video <path>",
      "attach a video (mp4/webm, ≤50MB); repeatable up to 8 total",
      collect,
      [] as string[],
    )
    .option(
      "--file <path>",
      "attach a document (pdf/docx/xlsx/md, ≤25MB); repeatable up to 8 total",
      collect,
      [] as string[],
    )
    .action(
      async (
        text: string[],
        opts: { stdin?: boolean; image?: string[]; video?: string[]; file?: string[] },
      ) => {
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
          uploadVideo: (conn, p) => uploadVideoFile(conn, p),
          uploadDocument: (conn, p) => uploadDocumentFile(conn, p),
          send: (c, ids) => client.send(c, ids),
        };
        try {
          await runSend(
            {
              content,
              images: opts.image ?? [],
              videos: opts.video ?? [],
              documents: opts.file ?? [],
              conn: cfg,
            },
            deps,
          );
        } catch (err) {
          console.error((err as Error).message);
          process.exit(1);
        }
      },
    );
}
