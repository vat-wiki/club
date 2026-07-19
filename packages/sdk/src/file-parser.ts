// File content parser for agents
//
// Converts various file formats into plain text that agents can read.
// Supports: text, JSON, PDF, Word (.docx), Excel (.xlsx), markdown

import { AttachmentMime, type AttachmentMime as AttachmentMimeType } from "@club/shared";
import { formatError } from "./errors.js";

/** Validate that a MIME type is one of the accepted attachment types. */
function _isValidAttachmentMime(mime: string): mime is AttachmentMimeType {
  return AttachmentMime.safeParse(mime).success;
}

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

export type FileContent = {
  text: string;
  format: string;
  metadata?: {
    title?: string;
    author?: string;
    subject?: string;
    pages?: number;
    sheets?: string[];
  };
};

/**
 * Parse file buffer into readable text based on MIME type.
 * Returns plain text representation that agents can process.
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
