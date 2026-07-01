import { describe, it, expect } from "vitest";
import { MAX_IMAGE_BYTES } from "@club/shared";
import {
  validateImageFile,
  isAllowedImageMime,
  humanBytes,
  extractImageFiles,
  IMAGE_MIME_WHITELIST,
} from "./upload";

function file(name: string, type: string, size: number): File {
  // jsdom File doesn't need real bytes for our size-based checks.
  return new File([new Uint8Array(size)], name, { type });
}

describe("upload helpers — MIME whitelist", () => {
  it("accepts the four supported image types", () => {
    expect(isAllowedImageMime("image/png")).toBe(true);
    expect(isAllowedImageMime("image/jpeg")).toBe(true);
    expect(isAllowedImageMime("image/gif")).toBe(true);
    expect(isAllowedImageMime("image/webp")).toBe(true);
  });

  it("rejects non-image and unsupported image types", () => {
    expect(isAllowedImageMime("image/svg+xml")).toBe(false);
    expect(isAllowedImageMime("image/bmp")).toBe(false);
    expect(isAllowedImageMime("application/pdf")).toBe(false);
    expect(isAllowedImageMime("video/mp4")).toBe(false);
    expect(isAllowedImageMime("")).toBe(false);
  });

  it("whitelist matches the shared ImageMime enum", () => {
    expect(IMAGE_MIME_WHITELIST).toEqual([
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
    ]);
  });
});

describe("upload helpers — validateImageFile", () => {
  it("accepts a valid image under the size cap", () => {
    expect(validateImageFile(file("a.png", "image/png", 1024))).toBeNull();
  });

  it("accepts an image exactly at the size cap", () => {
    expect(validateImageFile(file("a.jpg", "image/jpeg", MAX_IMAGE_BYTES))).toBeNull();
  });

  it("rejects a wrong-type file with invalidMime", () => {
    expect(validateImageFile(file("a.svg", "image/svg+xml", 100))).toEqual({
      key: "image.invalidMime",
    });
  });

  it("rejects an over-size file with tooLarge (size vars for a specific number)", () => {
    const oversized = MAX_IMAGE_BYTES + 1;
    expect(validateImageFile(file("big.png", "image/png", oversized))).toEqual({
      key: "image.tooLarge",
      vars: { max: humanBytes(MAX_IMAGE_BYTES), size: humanBytes(oversized) },
    });
  });
});

describe("upload helpers — humanBytes", () => {
  it("formats bytes / KB / MB without trailing .0", () => {
    expect(humanBytes(500)).toBe("500B");
    expect(humanBytes(2048)).toBe("2KB");
    // 10MB exactly → "10MB"
    expect(humanBytes(10 * 1024 * 1024)).toBe("10MB");
    // 24MB → "24MB"
    expect(humanBytes(24 * 1024 * 1024)).toBe("24MB");
    // fractional MB keeps one decimal
    expect(humanBytes(10.5 * 1024 * 1024)).toBe("10.5MB");
  });
});

describe("upload helpers — extractImageFiles", () => {
  it("keeps image files and drops non-images", () => {
    const img = file("a.png", "image/png", 10);
    const pdf = file("b.pdf", "application/pdf", 10);
    const out = extractImageFiles([img, pdf]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(img);
  });

  it("returns empty for a list with no images", () => {
    expect(extractImageFiles([file("b.pdf", "application/pdf", 10)])).toEqual([]);
    expect(extractImageFiles([])).toEqual([]);
  });
});
