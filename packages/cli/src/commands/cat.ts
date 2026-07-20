// club cat <file-id>
//
// Read a file attachment from a club room.
//
// Defaults to printing the download URL — the most common use case for a
// human eyeballing a link. Use --content to parse documents into plain text
// (for agent consumption), --raw for raw base64 (for binary files), or
// --meta to inspect metadata (format, mime, filename) as JSON.

import { Command } from "commander";
import { withAuthClient } from "../client-factory.js";

/**
 * Options parsed for `club cat`.
 */
interface CatOpts {
  content: boolean;
  raw: boolean;
  meta: boolean;
}

export function makeCatCommand(): Command {
  return new Command("cat")
    .description("read a club file attachment (default: output URL)")
    .argument("<id>", "file attachment id")
    .option("--content", "parse and output file content (for text documents)")
    .option("--raw", "output raw base64 (for binary files)")
    .option("--meta", "output file metadata as JSON")
    .action(withAuthClient(async ([id, opts], client) => {
      const { content, raw, meta } = opts as CatOpts;
      const url = `${client.server}/files/${id}`;

      if (meta) {
        const parsed = await client.readFileContent(id);
        console.log(JSON.stringify({
          id,
          url,
          mime: parsed.mime,
          filename: parsed.filename,
          format: parsed.format,
          textLength: parsed.text.length,
          metadata: parsed.metadata,
        }, null, 2));
        return;
      }

      if (!content && !raw) {
        console.log(url);
        return;
      }

      if (content) {
        const parsed = await client.readFileContent(id);
        process.stdout.write(parsed.text);
        return;
      }

      const { buffer } = await client.getFile(id);
      const base64 = Buffer.from(buffer).toString("base64");
      process.stdout.write(base64);
    }));
}
