import { describe, expect, it } from "vitest";
import { contentDispositionFilename } from "./files.js";

describe("contentDispositionFilename", () => {
  it("returns null for empty/blank/missing filenames", () => {
    expect(contentDispositionFilename(null)).toBe(null);
    expect(contentDispositionFilename(undefined)).toBe(null);
    expect(contentDispositionFilename("")).toBe(null);
    expect(contentDispositionFilename("   ")).toBe(null);
  });

  it("returns RFC 5987 value for a normal ASCII filename", () => {
    const result = contentDispositionFilename("photo.jpg");
    expect(result).not.toBe(null);
    expect(result).toMatch(/^attachment; filename="photo\.jpg"; filename\*=UTF-8''photo\.jpg$/);
  });

  it("encodes non-ASCII filenames in filename*=UTF-8''", () => {
    const result = contentDispositionFilename("小劉的截圖.png");
    expect(result).not.toBe(null);
    expect(result).toMatch(/filename\*=UTF-8''[^;]+$/);
    // ASCII fallback still present (may strip CJK)
    expect(result).toMatch(/^attachment; filename="/);
  });

  it("escapes quotes and backslashes in ASCII fallback", () => {
    const result = contentDispositionFilename(`say"hi".png`);
    expect(result).not.toBe(null);
    expect(result).toMatch(/^attachment; filename="say\\\"hi\\\"\.png";/);
  });

  it("strips path separators and uses basename only", () => {
    const result = contentDispositionFilename("/tmp/malicious/../evil.png");
    expect(result).not.toBe(null);
    expect(result).toMatch(/^attachment; filename="evil\.png";/);
  });

  it("strips ASCII control characters", () => {
    const result = contentDispositionFilename("a\x00b\x1F\x7F.png");
    expect(result).not.toBe(null);
    expect(result).not.toMatch(/\x00|\x1F|\x7F/);
  });

  it("caps filename length at 200 chars", () => {
    const long = "A".repeat(500) + ".txt";
    const result = contentDispositionFilename(long);
    expect(result).not.toBe(null);
    // filename= value should not exceed 200 + ".txt" padding
    const asciiFallback = result!.split('; filename=')[1].split(';')[0].replace(/^"|"$/g, "");
    expect(asciiFallback.length).toBeLessThanOrEqual(200);
  });

  it("percent-encodes special RFC 5987 chars (! ' ( ))", () => {
    const result = contentDispositionFilename("a!b'c(d).png");
    expect(result).not.toBe(null);
    expect(result).toMatch(/%21/); // !
    expect(result).toMatch(/%27/); // '
    expect(result).toMatch(/%28/); // (
    expect(result).toMatch(/%29/); // )
  });
});
