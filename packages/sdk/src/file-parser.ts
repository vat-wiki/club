// File content parser for agents
//
// Converts various file formats into plain text that agents can read.
// Supports: text, JSON, PDF, Word (.docx), Excel (.xlsx), markdown

import { type AttachmentMime as AttachmentMimeType } from "@club/shared";

import { formatError } from "./errors.js";

/** Map of accepted text-based MIME types for direct decoding. */
const TEXT_MIMES: readonly string[] = [
  "text/plain",
  "text/html",
  "text/css",
  "text/csv",
  "text/xml",
  "text/markdown",
  "application/json",
];

/** Map of accepted document MIME types that need specialized parsing. */
const DOCUMENT_MIMES: readonly AttachmentMimeType[] = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

// ── Format tags ─────────────────────────────────────────────────────
//
// Closed union of all `format` tags the parser may emit. Keeping this
// literal union turns downstream branching on `format` into exhaustive
// switching at the type level — adding a new parser variant requires
// adding a tag here, and the compiler surfaces any branch that forgets it.

/** Format tags emitted for text-based MIME types (decoded verbatim). */
export type TextFormatTag =
  | "text/plain"
  | "text/html"
  | "text/css"
  | "text/csv"
  | "text/xml"
  | "text/markdown";

/** Format tags emitted for structured documents (specialized parser). */
export type DocumentFormatTag = "pdf" | "docx" | "xlsx";

/** Format tags emitted when a document parser failed. */
export type DocumentErrorFormatTag = "pdf-error" | "docx-error" | "xlsx-error";

/** Full closed union of all `format` tags a parser may emit. */
export type FileFormatTag =
  | TextFormatTag
  | "json"
  | DocumentFormatTag
  | DocumentErrorFormatTag
  | (string & {}); // any accepted AttachmentMime surfaced verbatim for unrecognized binaries

/**
 * Parsed file content suitable for agent consumption.
 *
 * `text` is the readable body (plain text, pretty-printed JSON, extracted
 * document text, or an error message for unparseable formats). `format` is a
 * closed machine-readable tag so callers can branch exhaustively.
 * `metadata` carries optional title/author/pages/sheets the parser could
 * recover.
 */
export type FileContent = {
  text: string;
  format: FileFormatTag;
  metadata?: {
    title?: string;
    author?: string;
    subject?: string;
    pages?: number;
    sheets?: string[];
  };
};

/**
 * Parse a file buffer into readable text for agent consumption.
 *
 * Decodes text files directly (plain, JSON, HTML, CSV, XML, markdown),
 * pretty-prints JSON, and extracts text from documents via dynamic imports
 * (`pdf-parse`, `mammoth`, `xlsx`). Unrecognised MIME types fall back to
 * a descriptive binary placeholder.
 *
 * @param buffer - Raw file bytes.
 * @param mime - MIME type (used to select the parser; must be an accepted
 * AttachmentMime value for documents).
 * @param _filename - Optional filename hint; surfaced in metadata where
 * useful (currently reserved for future use).
 * @returns Parsed text content with a `format` tag and optional metadata.
 */
export async function parseFileContent(
  buffer: ArrayBuffer,
  mime: string,
  _filename?: string,
): Promise<FileContent> {
  const uint8 = new Uint8Array(buffer);

  // Text files - decode directly
  if (TEXT_MIMES.includes(mime)) {
    const decoder = new TextDecoder("utf-8");
    const text = decoder.decode(uint8);
    // JSON - pretty format it
    if (mime === "application/json") {
      try {
        return {
          text: JSON.stringify(JSON.parse(text), null, 2),
          format: "json",
        };
      } catch {
        // Invalid JSON, return as-is
        return { text, format: "json" };
      }
    }
    return { text, format: mime };
  }

  // Specialized document parsers
  if (DOCUMENT_MIMES.includes(mime as AttachmentMimeType)) {
    switch (mime) {
      case "application/pdf":
        return await parsePDF(uint8);
      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return await parseDocx(uint8);
      case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        return await parseXlsx(uint8);
    }
  }

  // Fallback: binary files
  return {
    text: `[Binary file: ${mime}, size: ${buffer.byteLength} bytes]`,
    format: mime,
  };
}

// PDF parsing using pdf-parse
interface PDFParseResult {
  text: string;
  info?: { Title?: string; Author?: string; Subject?: string };
  numpages?: number;
}
async function parsePDF(buffer: Uint8Array): Promise<FileContent> {
  try {
    // Dynamic import for pdf-parse (Node-only)
    const pdfParseMod = await import("pdf-parse");
    const pdfParse = "default" in pdfParseMod ? pdfParseMod.default : pdfParseMod;
    const data: PDFParseResult = await pdfParse(Buffer.from(buffer));

    const metadata: FileContent["metadata"] = {};
    if (data.info?.Title) metadata.title = data.info.Title;
    if (data.info?.Author) metadata.author = data.info.Author;
    if (data.info?.Subject) metadata.subject = data.info.Subject;
    if (data.numpages) metadata.pages = data.numpages;

    return {
      text: data.text || "[Empty or unreadable PDF]",
      format: "pdf",
      metadata,
    };
  } catch (err) {
    return {
      text: `[Failed to parse PDF: ${formatError(err)}]`,
      format: "pdf-error",
    };
  }
}

// Word (.docx) parsing using mammoth
async function parseDocx(buffer: Uint8Array): Promise<FileContent> {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });

    return {
      text: result.value || "[Empty document]",
      format: "docx",
    };
  } catch (err) {
    return {
      text: `[Failed to parse Word document: ${formatError(err)}]`,
      format: "docx-error",
    };
  }
}

// Excel (.xlsx) parsing using xlsx
async function parseXlsx(buffer: Uint8Array): Promise<FileContent> {
  try {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });

    const sheets: string[] = [];
    let output = "";

    workbook.SheetNames.forEach((sheetName: string) => {
      sheets.push(sheetName);
      const sheet = workbook.Sheets[sheetName];
      output += `\n## Sheet: ${sheetName}\n`;

      // Convert to CSV-like format for readability
      const csv = XLSX.utils.sheet_to_csv(sheet);
      output += csv;
    });

    return {
      text: output.trim(),
      format: "xlsx",
      metadata: { sheets },
    };
  } catch (err) {
    return {
      text: `[Failed to parse Excel file: ${formatError(err)}]`,
      format: "xlsx-error",
    };
  }
}
