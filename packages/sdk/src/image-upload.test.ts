import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClubApiError } from "./index.js";
import { assertImageCount, uploadImageFile } from "./image-upload.js";

// A minimal 1x1 PNG — real magic bytes so image-size sniffs type:"png". This is
// the canonical smallest valid PNG (8-byte signature + IHDR + IDAT + IEND).
const MIN_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4" +
    "890000000a49444154789c636000000000020001e221bc330000000049454e44ae426082",
  "hex",
);

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// A fresh temp dir per test so files never leak; cleaned up at the end.
function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "club-img-"));
}

describe("assertImageCount", () => {
  it("accepts up to MAX_IMAGES_PER_MESSAGE (8) paths", () => {
    expect(() => assertImageCount(Array(8).fill("a.png"))).not.toThrow();
  });

  it("throws ClubApiError when too many images are requested", () => {
    expect(() => assertImageCount(Array(9).fill("a.png"))).toThrow(/too many images/);
    expect(() => assertImageCount(Array(9).fill("a.png"))).toThrow(ClubApiError);
  });

  it("accepts an empty list", () => {
    expect(() => assertImageCount([])).not.toThrow();
  });
});

describe("uploadImageFile", () => {
  it("reads, sniffs, and uploads a valid PNG, returning the attachment id", async () => {
    const d = tmpDir();
    const p = join(d, "pix.png");
    writeFileSync(p, MIN_PNG);
    try {
      const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
        expect(String(url)).toBe("http://x/files");
        const form = init.body as FormData;
        const blob = form.get("file") as Blob;
        // Sniffed mime comes from the magic bytes (image/png), not the extension.
        expect(blob.type).toBe("image/png");
        return jsonRes({ id: "att1", url: "/files/att1", mime: "image/png", size: MIN_PNG.byteLength });
      });
      globalThis.fetch = fetchMock as typeof fetch;

      const att = await uploadImageFile({ server: "http://x", key: "k" }, p);
      expect(att.id).toBe("att1");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("rejects a non-existent file with a readable error", async () => {
    await expect(uploadImageFile({ server: "http://x" }, "/no/such/file.png")).rejects.toThrow(
      /could not read/,
    );
  });

  it("rejects a non-image file (unrecognized magic bytes)", async () => {
    const d = tmpDir();
    const p = join(d, "not.png");
    writeFileSync(p, Buffer.from("definitely not an image"));
    try {
      globalThis.fetch = vi.fn(async () => jsonRes({}, 200)) as typeof fetch;
      await expect(uploadImageFile({ server: "http://x" }, p)).rejects.toThrow(
        /not a recognized image/,
      );
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("rejects an image whose format is not in the whitelist", async () => {
    // A minimal BMP — image-size sniffs type:"bmp", which is NOT in ImageMime.
    const d = tmpDir();
    const p = join(d, "pic.bmp");
    writeFileSync(
      p,
      Buffer.from(
        "424d3a000000000036000000280000000100000001000000010018000000000004000000" +
          "130b0000130b00000000000000000000000000ff",
        "hex",
      ),
    );
    try {
      globalThis.fetch = vi.fn(async () => jsonRes({}, 200)) as typeof fetch;
      await expect(uploadImageFile({ server: "http://x" }, p)).rejects.toThrow(
        /unsupported image type/,
      );
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
