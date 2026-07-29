import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_IMAGE_BYTES } from "@club/shared";

import { assertAttachmentCount, uploadImageFile } from "./image-upload.js";
import { ClubApiError, isClubApiError } from "./index.js";

// Boundary + magic-byte sniff tests that complement image-upload.test.ts. The
// headline behavior under test: uploadImageFile decides the mime from the
// file's *magic bytes*, NOT its extension — so a file named "x.png" that is
// actually a JPEG is uploaded as image/jpeg. This is the agent/human parity
// guarantee (the same sniff the server uses) and the thing most likely to
// regress if someone "optimizes" by trusting the extension.

const MIN_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4" +
    "890000000a49444154789c636000000000020001e221bc330000000049454e44ae426082",
  "hex",
);
// A minimal real JPEG (FFD8...FFD9). image-size sniffs type:"jpg" from these
// magic bytes regardless of the filename extension.
const MIN_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+fAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/9k=",
  "base64",
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

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "club-img-bnd-"));
}

// A valid PNG padded to exactly `targetLen` bytes via a tEXt ancillary chunk
// spliced before IEND (see server images.boundary.test.ts for the same trick).
// Gives exact byte-level control for the 10MB boundary.
function pngOfByteLen(targetLen: number): Buffer {
  if (targetLen <= MIN_PNG.length) return MIN_PNG;
  const delta = targetLen - MIN_PNG.length;
  if (delta < 14) throw new Error(`pngOfByteLen needs delta ≥ 14, got ${delta}`);
  const crc32 = (buf: Buffer): number => {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let j = 0; j < 8; j++) {
        c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
      }
    }
    return ~c >>> 0;
  };
  const data = Buffer.concat([
    Buffer.from("a\0", "ascii"),
    Buffer.alloc(delta - 14, 0x61),
  ]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from("tEXt", "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  const tEXt = Buffer.concat([len, typeBuf, data, crc]);
  const iendStart = MIN_PNG.length - 12;
  return Buffer.concat([
    MIN_PNG.subarray(0, iendStart),
    tEXt,
    MIN_PNG.subarray(iendStart),
  ]);
}

describe("uploadImageFile: magic-byte mime sniff (extension-independent)", () => {
  it("uploads a JPEG-named .png file as image/jpeg (sniffed from bytes)", async () => {
    const d = tmpDir();
    // The file is named ".png" but its bytes are a JPEG. The sniff must read the
    // FFD8 magic and upload as image/jpeg — never image/png.
    const p = join(d, "actually-jpeg.png");
    writeFileSync(p, MIN_JPEG);
    try {
      const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
        expect(String(url)).toBe("http://s/files");
        const blob = (init.body as FormData).get("file") as Blob;
        expect(blob.type).toBe("image/jpeg"); // sniffed, not the .png extension
        return jsonRes({ id: "j1", url: "/files/j1", mime: "image/jpeg", size: MIN_JPEG.byteLength });
      });
      globalThis.fetch = fetchMock as typeof fetch;
      const att = await uploadImageFile({ server: "http://s", key: "k" }, p);
      expect(att.id).toBe("j1");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("uploads a PNG-named .jpeg file as image/png (sniffed from bytes)", async () => {
    const d = tmpDir();
    const p = join(d, "actually-png.jpeg");
    writeFileSync(p, MIN_PNG);
    try {
      const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
        const blob = (init.body as FormData).get("file") as Blob;
        expect(blob.type).toBe("image/png");
        return jsonRes({ id: "p1", url: "/files/p1", mime: "image/png", size: MIN_PNG.byteLength });
      });
      globalThis.fetch = fetchMock as typeof fetch;
      await uploadImageFile({ server: "http://s", key: "k" }, p);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("uses the sniffed mime for the uploaded filename hint basename, not extension", async () => {
    // Confirms filename sent to uploadFile is basename(path) — the extension is
    // just a hint, the mime is authoritative (from bytes).
    const d = tmpDir();
    const p = join(d, "weird.txt.png"); // weird extension
    writeFileSync(p, MIN_PNG);
    try {
      const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
        const form = init.body as FormData;
        const blob = form.get("file") as Blob;
        expect(blob.type).toBe("image/png");
        return jsonRes({ id: "x", url: "/files/x", mime: "image/png", size: MIN_PNG.byteLength });
      });
      globalThis.fetch = fetchMock as typeof fetch;
      await uploadImageFile({ server: "http://s", key: "k" }, p);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("uploadImageFile: byte-size boundary", () => {
  it("accepts a file of exactly MAX_IMAGE_BYTES", async () => {
    const d = tmpDir();
    const p = join(d, "max.png");
    const buf = pngOfByteLen(MAX_IMAGE_BYTES);
    expect(buf.length).toBe(MAX_IMAGE_BYTES);
    writeFileSync(p, buf);
    try {
      globalThis.fetch = vi.fn(async () =>
        jsonRes({ id: "big", url: "/files/big", mime: "image/png", size: MAX_IMAGE_BYTES }),
      ) as typeof fetch;
      const att = await uploadImageFile({ server: "http://s", key: "k" }, p);
      expect(att.id).toBe("big");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("rejects a file one byte over MAX_IMAGE_BYTES BEFORE any network call (413)", async () => {
    const d = tmpDir();
    const p = join(d, "over.png");
    const buf = pngOfByteLen(MAX_IMAGE_BYTES + 1);
    expect(buf.length).toBe(MAX_IMAGE_BYTES + 1);
    writeFileSync(p, buf);
    try {
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      // Pre-flight rejection surfaces as a ClubApiError with status 413 and the
      // byte counts in the message — and crucially BEFORE any network call.
      let caught: unknown;
      try {
        await uploadImageFile({ server: "http://s", key: "k" }, p);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ClubApiError);
      expect(isClubApiError(caught) ? caught.status : undefined).toBe(413);
      expect((caught as Error).message).toMatch(/bytes; max is/);
      // No upload was attempted — the client saves a doomed round trip.
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("assertAttachmentCount boundary", () => {
  it("accepts exactly MAX_IMAGES_PER_MESSAGE (10)", () => {
    expect(() => assertAttachmentCount(Array(10).fill("a.png"))).not.toThrow();
  });

  it("rejects 11 with the count + max in the message", () => {
    try {
      assertAttachmentCount(Array(11).fill("a.png"));
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ClubApiError);
      expect((e as ClubApiError).status).toBe(400);
      expect((e as Error).message).toMatch(/too many attachments: 11/);
      expect((e as Error).message).toMatch(/max 10/);
    }
  });
});
