import { describe, it, expect } from "vitest";
import { detectAndVerifyMime } from "./files.js";

/**
 * Minimal valid file headers (just the magic bytes, padded with zeroes).
 * These are not real decodable files — imageSize / real decoders will
 * reject them — but the magic-byte detector only cares about the header.
 */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);
const WEBP = Buffer.from([0x52, 0x59, 0x56, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x00]); // RIFF....WEBP + padding
const MP4 = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00]); // ftyp at offset 4 + isoM + padding
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00]);
const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]); // PK\x03\x04 local file header
const UNKNOWN = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00]);

// AnyMime: union of all accepted attachment MIMEs — used by the test suite
// as the type of `claimed` arguments to `detectAndVerifyMime`.
type _AnyMime =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp"
  | "video/mp4"
  | "video/webm"
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  | "text/markdown";

describe("detectAndVerifyMime", () => {
  // ── Happy path: claimed kind matches detected kind ────────────────
  it("accepts a PNG claimed as image/png", () => {
    expect(detectAndVerifyMime(PNG, "image/png")).toBe("image/png");
  });
  it("accepts a JPEG claimed as image/jpeg", () => {
    expect(detectAndVerifyMime(JPEG, "image/jpeg")).toBe("image/jpeg");
  });
  it("accepts a GIF claimed as image/gif", () => {
    expect(detectAndVerifyMime(GIF, "image/gif")).toBe("image/gif");
  });
  it("accepts a WebP claimed as image/webp", () => {
    expect(detectAndVerifyMime(WEBP, "image/webp")).toBe("image/webp");
  });
  it("accepts an MP4 claimed as video/mp4", () => {
    expect(detectAndVerifyMime(MP4, "video/mp4")).toBe("video/mp4");
  });
  it("accepts a WebM claimed as video/webm", () => {
    expect(detectAndVerifyMime(WEBM, "video/webm")).toBe("video/webm");
  });
  it("accepts a PDF claimed as application/pdf", () => {
    expect(detectAndVerifyMime(PDF, "application/pdf")).toBe("application/pdf");
  });
  it("accepts a docx ZIP claimed as docx MIME", () => {
    expect(detectAndVerifyMime(ZIP, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });
  it("accepts an xlsx ZIP claimed as xlsx MIME", () => {
    expect(detectAndVerifyMime(ZIP, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  // ── Cross-kind confusion: claimed kind != detected kind ──────────
  it("rejects an MP4 claimed as image/png (MIME confusion)", () => {
    expect(detectAndVerifyMime(MP4, "image/png")).toBeNull();
  });
  it("rejects a PNG claimed as video/mp4", () => {
    expect(detectAndVerifyMime(PNG, "video/mp4")).toBeNull();
  });
  it("rejects a PDF claimed as image/jpeg", () => {
    expect(detectAndVerifyMime(PDF, "image/jpeg")).toBeNull();
  });
  it("rejects a JPEG claimed as application/pdf", () => {
    expect(detectAndVerifyMime(JPEG, "application/pdf")).toBeNull();
  });
  it("rejects a GIF claimed as video/webm", () => {
    expect(detectAndVerifyMime(GIF, "video/webm")).toBeNull();
  });

  // ── ZIP-family edge cases ────────────────────────────────────────
  it("rejects a ZIP claimed as text/markdown (a .md cannot be a ZIP)", () => {
    expect(detectAndVerifyMime(ZIP, "text/markdown")).toBeNull();
  });
  it("rejects a PNG claimed as text/markdown", () => {
    expect(detectAndVerifyMime(PNG, "text/markdown")).toBeNull();
  });

  // ── Unknown / short content ──────────────────────────────────────
  it("rejects a buffer with no recognized magic signature", () => {
    expect(detectAndVerifyMime(UNKNOWN, "image/png")).toBeNull();
  });
  it("rejects an empty buffer", () => {
    expect(detectAndVerifyMime(Buffer.alloc(0), "image/png")).toBeNull();
  });
  it("rejects a 1-byte buffer", () => {
    expect(detectAndVerifyMime(Buffer.from([0xff]), "image/png")).toBeNull();
  });
});
