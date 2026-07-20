import { describe, it, expect, vi } from "vitest";
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MAX_DOCUMENT_BYTES } from "@club/shared";
import { ClubApiError, type ClubConn } from "@club/sdk";
import {
  validateImageFile,
  validateVideoFile,
  validateDocumentFile,
  validateMediaFile,
  isAllowedImageMime,
  isAllowedVideoMime,
  isAllowedDocumentMime,
  humanBytes,
  extractImageFiles,
  extractMediaFiles,
  extractAttachmentFiles,
  IMAGE_MIME_WHITELIST,
  VIDEO_MIME_WHITELIST,
  DOCUMENT_MIME_WHITELIST,
  uploadImage,
  _setCreateXHR,
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

describe("upload helpers — video whitelist + validateVideoFile", () => {
  it("accepts mp4 and webm", () => {
    expect(isAllowedVideoMime("video/mp4")).toBe(true);
    expect(isAllowedVideoMime("video/webm")).toBe(true);
  });

  it("rejects unsupported video containers and non-video", () => {
    expect(isAllowedVideoMime("video/quicktime")).toBe(false);
    expect(isAllowedVideoMime("video/x-matroska")).toBe(false);
    expect(isAllowedVideoMime("image/png")).toBe(false);
  });

  it("whitelist matches the shared VideoMime enum", () => {
    expect(VIDEO_MIME_WHITELIST).toEqual(["video/mp4", "video/webm"]);
  });

  it("accepts a valid video under the size cap", () => {
    expect(validateVideoFile(file("a.mp4", "video/mp4", 1024))).toBeNull();
  });

  it("accepts a video exactly at the size cap", () => {
    expect(validateVideoFile(file("a.webm", "video/webm", MAX_VIDEO_BYTES))).toBeNull();
  });

  it("rejects a wrong-type video with invalidMime", () => {
    expect(validateVideoFile(file("a.mov", "video/quicktime", 100))).toEqual({
      key: "video.invalidMime",
    });
  });

  it("rejects an over-size video with tooLarge", () => {
    const oversized = MAX_VIDEO_BYTES + 1;
    expect(validateVideoFile(file("big.mp4", "video/mp4", oversized))).toEqual({
      key: "video.tooLarge",
      vars: { max: humanBytes(MAX_VIDEO_BYTES), size: humanBytes(oversized) },
    });
  });
});

describe("upload helpers — validateMediaFile (dispatch)", () => {
  it("validates images via the image path", () => {
    expect(validateMediaFile(file("a.png", "image/png", 100))).toBeNull();
    expect(validateMediaFile(file("a.svg", "image/svg+xml", 100))).toEqual({
      key: "image.invalidMime",
    });
  });

  it("validates videos via the video path", () => {
    expect(validateMediaFile(file("a.mp4", "video/mp4", 100))).toBeNull();
    expect(validateMediaFile(file("a.mov", "video/quicktime", 100))).toEqual({
      key: "video.invalidMime",
    });
  });

  it("rejects a non-attachment file as an invalid document", () => {
    // .zip is none of image/video/document — validateMediaFile routes it to the
    // document validator, which rejects it as an unsupported document.
    expect(validateMediaFile(file("a.zip", "application/zip", 100))).toEqual({
      key: "document.invalidMime",
    });
  });
});

describe("upload helpers — extractMediaFiles", () => {
  it("keeps both image and video files, drops the rest", () => {
    const img = file("a.png", "image/png", 10);
    const vid = file("b.mp4", "video/mp4", 10);
    const pdf = file("c.pdf", "application/pdf", 10);
    const out = extractMediaFiles([img, vid, pdf]);
    expect(out).toEqual([img, vid]);
  });

  it("returns empty for a list with no media", () => {
    expect(extractMediaFiles([file("c.pdf", "application/pdf", 10)])).toEqual([]);
    expect(extractMediaFiles([])).toEqual([]);
  });
});

describe("upload helpers — document whitelist + validateDocumentFile", () => {
  it("accepts pdf/docx/xlsx/md", () => {
    expect(
      validateDocumentFile(file("a.pdf", "application/pdf", 1024)),
    ).toBeNull();
    expect(
      validateDocumentFile(
        file("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 1024),
      ),
    ).toBeNull();
    expect(
      validateDocumentFile(
        file("a.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 1024),
      ),
    ).toBeNull();
    expect(validateDocumentFile(file("a.md", "text/markdown", 1024))).toBeNull();
  });

  it("whitelist matches the shared DocumentMime enum", () => {
    expect(DOCUMENT_MIME_WHITELIST).toEqual([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/markdown",
    ]);
    expect(isAllowedDocumentMime("application/pdf")).toBe(true);
    expect(isAllowedDocumentMime("application/zip")).toBe(false);
  });

  it("rejects a non-whitelisted document", () => {
    expect(validateDocumentFile(file("a.zip", "application/zip", 100))).toEqual({
      key: "document.invalidMime",
    });
  });

  it("rejects an over-size document with tooLarge", () => {
    const oversized = MAX_DOCUMENT_BYTES + 1;
    expect(validateDocumentFile(file("big.pdf", "application/pdf", oversized))).toEqual({
      key: "document.tooLarge",
      vars: { max: humanBytes(MAX_DOCUMENT_BYTES), size: humanBytes(oversized) },
    });
  });
});

describe("upload helpers — extractAttachmentFiles", () => {
  it("keeps images, videos, AND documents; drops the rest", () => {
    const img = file("a.png", "image/png", 10);
    const vid = file("b.mp4", "video/mp4", 10);
    const doc = file("c.pdf", "application/pdf", 10);
    const zip = file("d.zip", "application/zip", 10);
    expect(extractAttachmentFiles([img, vid, doc, zip])).toEqual([img, vid, doc]);
  });

  it("returns empty for a list with no attachments", () => {
    expect(extractAttachmentFiles([file("d.zip", "application/zip", 10)])).toEqual([]);
    expect(extractAttachmentFiles([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// uploadImage — mock XHR so the multipart upload can be exercised in jsdom
// without hitting a real server. The real flow: FormData → POST /files →
// JSON body, with a Bearer Authorization header when conn.key is set.
// ---------------------------------------------------------------------------

interface MockXHR {
  status: number;
  responseText: string;
  open: ReturnType<typeof vi.fn>;
  setRequestHeader: (k: string, v: string) => void;
  send: ReturnType<typeof vi.fn>;
  onload?: () => void;
  onerror?: () => void;
  ontimeout?: () => void;
  onabort?: () => void;
  upload: { onprogress: (e: ProgressEvent) => void };
  headers: Record<string, string>;
  sentBody: FormData | null;
  calledAbort: boolean;
  sendWasCalled: boolean;
}

function mkXHR(): MockXHR {
  return {
    status: 200,
    responseText: "",
    open: vi.fn(),
    setRequestHeader: vi.fn() as (k: string, v: string) => void,
    send: vi.fn(),
    upload: { onprogress: vi.fn<(e: ProgressEvent) => void>() },
    headers: {},
    sentBody: null,
    calledAbort: false,
    sendWasCalled: false,
  };
}

function withXHR<T>(factory: (xhr: MockXHR) => Promise<T> | T): Promise<T> {
  const xhr = mkXHR();
  const orig = xhr.setRequestHeader;
  xhr.setRequestHeader = vi.fn((k: string, v: string) => {
    xhr.headers[k] = v;
    orig(k, v);
  });
  xhr.send = vi.fn((body: unknown) => {
    xhr.sentBody = body as FormData;
    xhr.sendWasCalled = true;
  });
  _setCreateXHR(() => xhr as unknown as XMLHttpRequest);
  return Promise.resolve(factory(xhr)).finally(() => {
    _setCreateXHR(() => new XMLHttpRequest());
  });
}

function okBody() {
  return JSON.stringify({ id: "f1", url: "/files/f1", mime: "image/png", filename: "pic.png", size: 1024 });
}

const conn: ClubConn = { server: "http://localhost:3000", key: "club_human_test" };
const fileConn: ClubConn = { server: "http://localhost:3000", key: undefined };

describe("upload helpers — uploadImage (XHR path)", () => {
  const img = file("pic.png", "image/png", 1024);

  it("posts to /files with the file in FormData and returns the JSON body", async () => {
    await withXHR(async (xhr) => {
      xhr.responseText = okBody();
      const p = uploadImage(conn, img);
      xhr.onload!();
      const res = await p;
      expect(xhr.open).toHaveBeenCalledWith("POST", "http://localhost:3000/files");
      expect(xhr.headers).toHaveProperty("Authorization", "Bearer club_human_test");
      expect(xhr.sentBody).toBeInstanceOf(FormData);
      expect(res).toEqual({ id: "f1", url: "/files/f1", mime: "image/png", filename: "pic.png", size: 1024 });
    });
  });

  it("omits the Authorization header when conn.key is absent", async () => {
    await withXHR(async (xhr) => {
      xhr.responseText = okBody();
      const p = uploadImage(fileConn, img);
      xhr.onload!();
      await p;
      expect(xhr.headers).not.toHaveProperty("Authorization");
    });
  });

  it("emits progress events to onProgress", async () => {
    const onProgress = vi.fn();
    await withXHR(async (xhr) => {
      xhr.responseText = okBody();
      const p = uploadImage(conn, img, { onProgress });
      xhr.upload.onprogress({ loaded: 512, total: 1024, lengthComputable: true } as ProgressEvent);
      xhr.onload!();
      await p;
      expect(onProgress).toHaveBeenCalledWith(512, 1024);
    });
  });

  it("skips onProgress when length is not computable", async () => {
    const onProgress = vi.fn();
    await withXHR(async (xhr) => {
      xhr.responseText = okBody();
      const p = uploadImage(conn, img, { onProgress });
      xhr.upload.onprogress({ loaded: 512, total: 1024, lengthComputable: false } as ProgressEvent);
      xhr.onload!();
      await p;
      expect(onProgress).not.toHaveBeenCalled();
    });
  });

  it("throws ClubApiError on non-2xx status", async () => {
    await withXHR(async (xhr) => {
      xhr.status = 500;
      xhr.responseText = JSON.stringify({ error: "disk full" });
      const p = uploadImage(conn, img);
      xhr.onload!();
      await expect(p).rejects.toThrow(ClubApiError);
    });
  });

  it("uses the response error string as the message", async () => {
    await withXHR(async (xhr) => {
      xhr.status = 413;
      xhr.responseText = JSON.stringify({ error: "file too big" });
      const p = uploadImage(conn, img);
      xhr.onload!();
      await expect(p).rejects.toThrow("file too big");
    });
  });

  it("falls back to HTTP <status> when the body is not JSON", async () => {
    await withXHR(async (xhr) => {
      xhr.status = 403;
      xhr.responseText = "forbidden";
      const p = uploadImage(conn, img);
      xhr.onload!();
      await expect(p).rejects.toThrow("HTTP 403");
    });
  });

  it("throws ClubApiError on network error", async () => {
    await withXHR(async (xhr) => {
      const p = uploadImage(conn, img);
      xhr.onerror!();
      await expect(p).rejects.toThrow("network error");
    });
  });

  it("throws ClubApiError on timeout", async () => {
    await withXHR(async (xhr) => {
      const p = uploadImage(conn, img);
      xhr.ontimeout!();
      await expect(p).rejects.toThrow("upload timeout");
    });
  });

  it("throws ClubApiError on abort (from explicit AbortController)", async () => {
    await withXHR(async (xhr) => {
      const p = uploadImage(conn, img);
      xhr.onabort!();
      await expect(p).rejects.toThrow("upload timeout");
    });
  });
});
