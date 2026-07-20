import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertAttachmentCount,
  uploadDocumentFile,
  uploadImageFile,
  uploadVideoFile,
} from "./image-upload.js";
import { ClubApiError } from "./index.js";

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

describe("assertAttachmentCount", () => {
  it("accepts up to MAX_IMAGES_PER_MESSAGE (10) paths", () => {
    expect(() => assertAttachmentCount(Array(10).fill("a.png"))).not.toThrow();
  });

  it("throws ClubApiError when too many attachments are requested", () => {
    expect(() => assertAttachmentCount(Array(11).fill("a.png"))).toThrow(/too many attachments/);
    expect(() => assertAttachmentCount(Array(11).fill("a.png"))).toThrow(ClubApiError);
  });

  it("accepts an empty list", () => {
    expect(() => assertAttachmentCount([])).not.toThrow();
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

// Minimal container headers — only the bytes sniffVideoMime inspects matter;
// the rest is padding. mp4: a "ftyp" box at offset 4 with major brand "mp42".
// webm: the EBML magic 0x1A45DFA3. mov: ftyp with brand "qt  " (QuickTime —
// not browser-playable, so the sniffer must reject it).
const MIN_MP4 = Buffer.from("00000018667479706d703432000000000000000000000000", "hex");
const MIN_WEBM = Buffer.from("1a45dfa30000000000000000000000000000000000000000", "hex");
const MIN_MOV = Buffer.from("0000001866747970717420200000000000000000", "hex");

describe("uploadVideoFile", () => {
  it("reads, sniffs, and uploads a valid mp4, returning the attachment id", async () => {
    const d = tmpDir();
    const p = join(d, "clip.dat"); // wrong extension on purpose — sniffing ignores it
    writeFileSync(p, MIN_MP4);
    try {
      const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
        expect(String(url)).toBe("http://x/files");
        const blob = (init.body as FormData).get("file") as Blob;
        // Sniffed from the ftyp magic bytes, not the filename.
        expect(blob.type).toBe("video/mp4");
        return jsonRes({ id: "v1", url: "/files/v1", mime: "video/mp4", size: MIN_MP4.byteLength });
      });
      globalThis.fetch = fetchMock as typeof fetch;

      const att = await uploadVideoFile({ server: "http://x", key: "k" }, p);
      expect(att.id).toBe("v1");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("sniffs a webm as video/webm", async () => {
    const d = tmpDir();
    const p = join(d, "clip.webm");
    writeFileSync(p, MIN_WEBM);
    try {
      const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
        const blob = (init.body as FormData).get("file") as Blob;
        expect(blob.type).toBe("video/webm");
        return jsonRes({ id: "v2", url: "/files/v2", mime: "video/webm", size: MIN_WEBM.byteLength });
      });
      globalThis.fetch = fetchMock as typeof fetch;
      const att = await uploadVideoFile({ server: "http://x" }, p);
      expect(att.id).toBe("v2");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("rejects a .mov (QuickTime ftyp) as not browser-playable", async () => {
    const d = tmpDir();
    const p = join(d, "clip.mov");
    writeFileSync(p, MIN_MOV);
    try {
      globalThis.fetch = vi.fn(async () => jsonRes({}, 200)) as typeof fetch;
      await expect(uploadVideoFile({ server: "http://x" }, p)).rejects.toThrow(
        /not a recognized video/,
      );
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("rejects a non-video file (image magic bytes)", async () => {
    const d = tmpDir();
    const p = join(d, "fake.mp4");
    writeFileSync(p, MIN_PNG); // PNG magic — not a video container
    try {
      globalThis.fetch = vi.fn(async () => jsonRes({}, 200)) as typeof fetch;
      await expect(uploadVideoFile({ server: "http://x" }, p)).rejects.toThrow(
        /not a recognized video/,
      );
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("rejects a non-existent file with a readable error", async () => {
    await expect(uploadVideoFile({ server: "http://x" }, "/no/such/file.mp4")).rejects.toThrow(
      /could not read/,
    );
  });
});

describe("uploadDocumentFile", () => {
  it("infers the MIME from the extension and uploads a pdf", async () => {
    const d = tmpDir();
    const p = join(d, "report.pdf");
    writeFileSync(p, Buffer.from("%PDF-1.4 body"));
    try {
      const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
        expect(String(url)).toBe("http://x/files");
        const blob = (init.body as FormData).get("file") as Blob;
        // MIME inferred from the .pdf extension (not sniffed from bytes).
        expect(blob.type).toBe("application/pdf");
        return jsonRes({
          id: "doc1",
          url: "/files/doc1",
          mime: "application/pdf",
          size: 0,
          filename: "report.pdf",
        });
      });
      globalThis.fetch = fetchMock as typeof fetch;
      const att = await uploadDocumentFile({ server: "http://x", key: "k" }, p);
      expect(att.id).toBe("doc1");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("infers docx/xlsx/md from their extensions", async () => {
    const cases: Record<string, string> = {
      "a.docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "a.xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "a.md": "text/markdown",
      "notes.markdown": "text/markdown",
    };
    for (const [name, mime] of Object.entries(cases)) {
      const d = tmpDir();
      const p = join(d, name);
      writeFileSync(p, Buffer.from("body"));
      try {
        const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
          expect(((init.body as FormData).get("file") as Blob).type).toBe(mime);
          return jsonRes({ id: "x", url: "/files/x", mime, size: 0 });
        });
        globalThis.fetch = fetchMock as typeof fetch;
        await uploadDocumentFile({ server: "http://x" }, p);
      } finally {
        rmSync(d, { recursive: true, force: true });
      }
    }
  });

  it("rejects an unsupported document extension", async () => {
    const d = tmpDir();
    const p = join(d, "a.zip");
    writeFileSync(p, Buffer.from("body"));
    try {
      globalThis.fetch = vi.fn(async () => jsonRes({}, 200)) as typeof fetch;
      await expect(uploadDocumentFile({ server: "http://x" }, p)).rejects.toThrow(
        /unsupported document type/,
      );
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
