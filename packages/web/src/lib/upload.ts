import {
  ImageMime,
  VideoMime,
  DocumentMime,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MAX_DOCUMENT_BYTES,
  type MessageAttachment,
  type UploadFileResponse,
} from "@club/shared";
import { ClubApiError, NETWORK_ERROR_STATUS, type ClubApiErrorStatus, type ClubConn } from "@club/sdk";

// The MIME whitelist is the single source of truth in @club/shared (ImageMime).
// Pre-flight locally so a wrong-format pick is rejected before any bytes hit
// the network — the server re-checks authoritatively anyway.
export const IMAGE_MIME_WHITELIST: readonly string[] = ImageMime.options;
export const VIDEO_MIME_WHITELIST: readonly string[] = VideoMime.options;
export const DOCUMENT_MIME_WHITELIST: readonly string[] = DocumentMime.options;

export function isAllowedImageMime(mime: string): boolean {
  return IMAGE_MIME_WHITELIST.includes(mime);
}

export function isAllowedVideoMime(mime: string): boolean {
  return VIDEO_MIME_WHITELIST.includes(mime);
}

export function isAllowedDocumentMime(mime: string): boolean {
  return DOCUMENT_MIME_WHITELIST.includes(mime);
}

export function humanBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    // 24MB → "24MB"; 10.5MB → "10.5MB" — drop trailing ".0".
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)}KB`;
  }
  return `${bytes}B`;
}

export type RejectReason = { key: string; vars?: Record<string, string | number> };

function validateAgainst(
  file: File,
  mimeWhitelist: readonly string[],
  maxBytes: number,
  keyPrefix: string,
): RejectReason | null {
  if (!mimeWhitelist.includes(file.type)) {
    return { key: `${keyPrefix}.invalidMime` };
  }
  if (file.size > maxBytes) {
    return {
      key: `${keyPrefix}.tooLarge`,
      vars: { max: humanBytes(maxBytes), size: humanBytes(file.size) },
    };
  }
  return null;
}

export function validateImageFile(file: File): RejectReason | null {
  return validateAgainst(file, IMAGE_MIME_WHITELIST, MAX_IMAGE_BYTES, "image");
}

export function validateVideoFile(file: File): RejectReason | null {
  return validateAgainst(file, VIDEO_MIME_WHITELIST, MAX_VIDEO_BYTES, "video");
}

export function validateDocumentFile(file: File): RejectReason | null {
  return validateAgainst(file, DOCUMENT_MIME_WHITELIST, MAX_DOCUMENT_BYTES, "document");
}

// Validate any attachment file (image, video, OR document) by dispatching on
// its MIME. Returns null when accepted, or a localized reject reason the caller
// turns into text via t(). Non-attachment files fall through to a document
// reject (the most permissive error label).
export function validateMediaFile(file: File): RejectReason | null {
  if (file.type.startsWith("video/")) return validateVideoFile(file);
  if (file.type.startsWith("image/")) return validateImageFile(file);
  return validateDocumentFile(file);
}

// Pull image files out of a DataTransferItemList / FileList, ignoring
// non-image items. Kept for callers/tests that only want images.
export function extractImageFiles(items: Iterable<File>): File[] {
  const out: File[] = [];
  for (const f of items) {
    if (f.type.startsWith("image/")) out.push(f);
  }
  return out;
}

// Pull image OR video files out of a DataTransferItemList / FileList, ignoring
// everything else. Kept for callers/tests that only handle media.
export function extractMediaFiles(items: Iterable<File>): File[] {
  const out: File[] = [];
  for (const f of items) {
    if (f.type.startsWith("image/") || f.type.startsWith("video/")) out.push(f);
  }
  return out;
}

// Pull any attachment (image, video, OR document) out of a DataTransferItemList
// / FileList, ignoring everything else. Documents match by exact MIME (they
// don't share a prefix), so they're checked against the whitelist set. The
// composer's picker / paste / drop route through here.
export function extractAttachmentFiles(items: Iterable<File>): File[] {
  const out: File[] = [];
  for (const f of items) {
    const m = f.type;
    if (
      m.startsWith("image/") ||
      m.startsWith("video/") ||
      (DOCUMENT_MIME_WHITELIST as readonly string[]).includes(m)
    ) {
      out.push(f);
    }
  }
  return out;
}

// Internal XHR factory so the upload path can be exercised in tests without
// mocking a global constructor. Production code keeps the default, which just
// returns a real XMLHttpRequest.
let createXHR: () => XMLHttpRequest = () => new XMLHttpRequest();
export function _setCreateXHR(fn: () => XMLHttpRequest) {
  createXHR = fn;
}

// HEADS-UP: this lives in web rather than @club/sdk because the SDK's
// transport layer is JSON-only (it JSON.stringifies every body). A multipart
// upload needs FormData + the browser's stream body, so it can't go through
// `request()`. Auth mirrors the transport exactly: a Bearer header when a key
// is present. The route this targets (POST /files) is owned by the backend and
// returns UploadFileResponse (structurally a MessageAttachment).
export async function uploadImage(
  conn: ClubConn,
  file: File,
  opts: { timeoutMs?: number; onProgress?: (loaded: number, total: number) => void } = {},
): Promise<UploadFileResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const xhr = createXHR();
  const headers: Record<string, string> = {};
  if (conn.key) headers.Authorization = `Bearer ${conn.key}`;

  try {
    xhr.open("POST", `${conn.server}/files`);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);

    if (opts.onProgress) {
      const onProgress = opts.onProgress;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
    }

    const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      xhr.onerror = () => reject(new ClubApiError("network error", NETWORK_ERROR_STATUS));
      xhr.ontimeout = () => reject(new ClubApiError("upload timeout", 408));
      xhr.onabort = () => reject(new ClubApiError("upload timeout", 408));
      xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
      xhr.send(formData);
    });

    if (!res.status || res.status < 200 || res.status >= 300) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = JSON.parse(res.body) as { error?: string };
        if (body?.error) msg = body.error;
      } catch {
        /* ignore non-JSON error bodies */
      }
      throw new ClubApiError(msg, res.status as ClubApiErrorStatus);
    }

    return JSON.parse(res.body) as MessageAttachment;
  } finally {
    clearTimeout(timer);
  }
}
