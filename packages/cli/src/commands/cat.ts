// club cat <file-id>
//
// Read a file attachment from a club room.
//
// Defaults to printing the download URL — the most common use case for a
// human eyeballing a link. Use --content to parse documents into plain text
// (for agent consumption), --raw for raw base64 (for binary files), or
// --meta to inspect metadata (format, mime, filename) as JSON.

import { Command } from "commander";

import type { ClubClient, ParsedFile } from "@club/sdk";

import { withAuthClient } from "../client-factory.js";

/**
 * Options parsed for `club cat`.
 */
export interface CatOpts {
  /** Parse and output file content as plain text (for agent consumption). */
  content: boolean;
  /** Output raw base64 (for binary files). */
  raw: boolean;
  /** Output file metadata as JSON. */
  meta: boolean;
}

/**
 * Dependencies injected into `runCat` so the pure logic can be unit-tested
 * without constructing a real `ClubClient` or spinning up Commander.
 */
export interface CatDeps {
  /** Resolve the download URL prefix for an attachment id. */
  server: string;
  /** Parse a file's text content and metadata. */
  readFileContent: (id: string) => Promise<ParsedFile>;
  /** Fetch a file's raw binary buffer. */
  getFile: (id: string) => Promise<{ buffer: ArrayBuffer }>;
}

/**
 * Orchestrates the `cat` subcommand: decides whether to emit a URL, parsed
 * content, raw base64, or metadata JSON for the requested file attachment.
 *
 * The default (no flag) is the URL — the human "show me the link" case.
 * `--content`, `--raw`, and `--meta` are mutually-priority branches:
 *   - `--meta` emits JSON with mime/format/filename/textLength/metadata.
 *   - `--content` streams parsed text to stdout (no trailing newline — caller
 *     may compose with other data).
 *   - `--raw` streams base64 to stdout.
 *
 * @param id - The file attachment id (whitespace-trimmed).
 * @param opts - Parsed command-line options.
 * @param deps - Injected client methods + server URL.
 * @throws Forwarded from `readFileContent` / `getFile` (network, 404, etc.).
 */
export async function runCat(
  id: string,
  opts: CatOpts,
  deps: CatDeps,
): Promise<void> {
  const cleanId = id.trim();
  if (!cleanId) throw new Error("file id required");
  const url = `${deps.server}/files/${cleanId}`;
  const { content, raw, meta } = opts;

  if (meta) {
    const parsed = await deps.readFileContent(cleanId);
    console.log(JSON.stringify({
      id: cleanId,
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
    const parsed = await deps.readFileContent(cleanId);
    process.stdout.write(parsed.text);
    return;
  }

  const { buffer } = await deps.getFile(cleanId);
  const base64 = Buffer.from(buffer).toString("base64");
  process.stdout.write(base64);
}

export function makeCatCommand(): Command {
  return new Command("cat")
    .description("read a club file attachment (default: output URL)")
    .argument("<id>", "file attachment id")
    .option("--content", "parse and output file content (for text documents)")
    .option("--raw", "output raw base64 (for binary files)")
    .option("--meta", "output file metadata as JSON")
    .action(withAuthClient(async (_cfg, [id, opts], client: ClubClient) => {
      return runCat(
        id,
        opts as CatOpts,
        {
          server: client.server,
          readFileContent: (id) => client.readFileContent(id),
          getFile: (id) => client.getFile(id),
        },
      );
    }));
}
