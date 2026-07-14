// File content parser for agents
//
// Converts various file formats into plain text that agents can read.
// Supports: text, JSON, PDF, Word (.docx), Excel (.xlsx), markdown

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
  filename?: string,
): Promise<FileContent> {
  const uint8 = new Uint8Array(buffer);

  // Text files - decode directly
  if (mime.startsWith("text/") || mime.includes("markdown")) {
    const decoder = new TextDecoder("utf-8");
    return {
      text: decoder.decode(uint8),
      format: mime,
    };
  }

  // JSON - decode with pretty formatting
  if (mime === "application/json") {
    const decoder = new TextDecoder("utf-8");
    const jsonText = decoder.decode(uint8);
    try {
      const parsed = JSON.parse(jsonText);
      return {
        text: JSON.stringify(parsed, null, 2),
        format: "json",
      };
    } catch {
      // Invalid JSON, return as-is
      return {
        text: jsonText,
        format: "json",
      };
    }
  }

  // PDF - extract text
  if (mime === "application/pdf") {
    return await parsePDF(uint8);
  }

  // Word (.docx) - extract text
  if (
    mime ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return await parseDocx(uint8);
  }

  // Excel (.xlsx) - convert to readable format
  if (
    mime ===
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return await parseXlsx(uint8);
  }

  // Fallback: binary files
  return {
    text: `[Binary file: ${mime}, size: ${buffer.byteLength} bytes]`,
    format: mime,
  };
}

// PDF parsing using pdf-parse
async function parsePDF(buffer: Uint8Array): Promise<FileContent> {
  try {
    // Dynamic import for pdf-parse (Node-only)
    const pdfParseMod = await import("pdf-parse");
    const pdfParse: any = "default" in pdfParseMod ? pdfParseMod.default : pdfParseMod;
    const data = await pdfParse(Buffer.from(buffer));

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
      text: `[Failed to parse PDF: ${(err as Error).message}]`,
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
      text: `[Failed to parse Word document: ${(err as Error).message}]`,
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

    workbook.SheetNames.forEach((sheetName) => {
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
      text: `[Failed to parse Excel file: ${(err as Error).message}]`,
      format: "xlsx-error",
    };
  }
}
