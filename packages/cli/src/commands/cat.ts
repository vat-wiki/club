// club cat <file-id>
//
// Read a file attachment from a club room.
// Default: outputs the file URL (most common use).
// Use --content to parse documents into text for agents.
// Use --meta to view file metadata.

import { Command } from "commander";
import { withAuthClient } from "../client-factory.js";

export function makeCatCommand(): Command {
  return new Command("cat")
    .description("read a club file attachment (default: output URL)")
    .argument("<id>", "file attachment id")
    .option("--content", "parse and output file content (for text documents)")
    .option("--raw", "output raw base64 (for binary files)")
    .option("--meta", "output file metadata as JSON")
    .option("--room <slug>", "room where the file was posted (unused; for API consistency)")
    .action(withAuthClient(async ([id, opts], client) => {
      const { content, raw, meta } = opts as {
        content: boolean;
        raw: boolean;
        meta: boolean;
        room?: string;
      };
      const url = `${client.server}/files/${id}`;

      // --meta: output metadata
      if (meta) {
        const parsed = await client.readFileContent(id);
        console.log(JSON.stringify({
          id,
          url,
          mime: parsed.mime,
          filename: parsed.filename,
          format: parsed.format,
          size: parsed.text.length,
          metadata: parsed.metadata,
        }, null, 2));
        return;
      }

      // Default: output URL
      if (!content && !raw) {
        console.log(url);
        return;
      }

      // --content: parse and output text
      if (content) {
        const parsed = await client.readFileContent(id);
        process.stdout.write(parsed.text);
        return;
      }

      // --raw: output base64
      const { buffer } = await client.getFile(id);
      const base64 = Buffer.from(buffer).toString("base64");
      process.stdout.write(base64);
    }));
}
