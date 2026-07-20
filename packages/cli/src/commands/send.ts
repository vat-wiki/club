import { Command } from "commander";

import { ClubClient } from "@club/sdk";
import { uploadDocumentFile,uploadImageFile, uploadVideoFile } from "@club/sdk/node";

import { runSend, type SendDeps } from "./send-impl.js";
import { defaultRoom, requireConfig } from "../config.js";
import { readStream } from "../stdin.js";

// Collect repeated flags into an array (commander coercion). Spread-copy avoids
// the shared-mutable-array pitfall that commander's default accumulator triggers
// when one command definition is reused across processes.
const collect = (v: string, acc: string[]) => [...acc, v];

export function makeSendCommand(): Command {
  return new Command("send")
    .description(
      'send a message — `club send "hi"`, `echo hi | club send` (auto-detects pipe), attach files with `--image` / `--video` / `--file <path>` (repeatable, ≤8 total), or target a room with `--room <slug>`',
    )
    .argument("[text...]", "message text (omit if piping or sending files only)")
    .option("--stdin", "read message body from stdin (auto-detected when piped)")
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
    .option(
      "--room <slug>",
      "post to this room (default: the room from `club enter`, or general)",
    )
    .action(
      async (
        text: string[],
        opts: {
          stdin?: boolean;
          image?: string[];
          video?: string[];
          file?: string[];
          room?: string;
        },
      ) => {
        // Auto-detect stdin: when no text args and stdin is piped, read it.
        // Explicit --stdin still works for clarity or testing.
        const useStdin = opts.stdin ?? (!text.length && !process.stdin.isTTY);
        let content: string;
        if (useStdin) {
          content = await readStream(process.stdin);
        } else {
          content = text.join(" ");
        }
        content = content.trim();

        const cfg = requireConfig();
        const client = new ClubClient(cfg);
        const room = opts.room ?? defaultRoom(cfg);

        const deps: SendDeps = {
          uploadImage: (conn, p) => uploadImageFile(conn, p),
          uploadVideo: (conn, p) => uploadVideoFile(conn, p),
          uploadDocument: (conn, p) => uploadDocumentFile(conn, p),
          send: (c, ids, r) => client.send(c, ids, r ? { room: r } : undefined),
        };

        await runSend(
          {
            content,
            images: opts.image ?? [],
            videos: opts.video ?? [],
            documents: opts.file ?? [],
            conn: cfg,
            room,
          },
          deps,
        );
      },
    );
}
