// Ambient declarations for the heavy, lazily-loaded file parsers used by
// file-parser.ts (PDF / Word / Excel). These packages are deliberately NOT listed
// in package.json dependencies: they are Node-only, pulled in via dynamic
// `import()` only when a matching file type is actually parsed, and a missing
// install is handled gracefully (file-parser.ts catches the failed import and
// returns an error string). Keeping them out of dependencies avoids bloating the
// browser-safe main entry of @club/sdk.
//
// These declarations exist solely so `tsc` doesn't flag the dynamic imports
// (TS2307). If any of these packages ever becomes a real dependency, delete its
// block here so the packaged types take over.

declare module "pdf-parse" {
  const pdfParse: (data: Buffer | string) => Promise<{
    text: string;
    numpages?: number;
    info?: { Title?: string; Author?: string; Subject?: string };
  }>;
  export default pdfParse;
}

declare module "mammoth" {
  export function extractRawText(input: {
    buffer: Buffer;
  }): Promise<{ value: string }>;
}

declare module "xlsx" {
  export function read(
    data: Uint8Array,
    opts: { type: string },
  ): { SheetNames: string[]; Sheets: Record<string, unknown> };
  export const utils: { sheet_to_csv(sheet: unknown): string };
}
