import {
  ImageMime,
  VideoMime,
  DocumentMime,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MAX_DOCUMENT_BYTES,
  type MessageAttachment,
  type UploadFileResponse,
} from '@club/shared';
import { ClubApiError, NETWORK_ERROR_STATUS, parseHttpErrorStatus, type ClubConn } from '@club/sdk';

/**
 * upload.ts — client-side media validation + multipart file upload for the
 * web UI.
 *
 * Validates files against the whitelists and size caps defined in `@club/shared`
 * (single source of truth) before any bytes hit the network. The server
 * re-checks authoritatively, but pre-flight rejects give the user instant
 * feedback instead of a round-trip error.
 *
 * Multipart upload (`uploadImage`) lives here — NOT in `@club/sdk` — because
 * the SDK's transport layer is JSON-only and cannot emit `FormData`/streaming
 * bodies. Auth mirrors the transport: a `Bearer` header when a key is present.
 *
 * > This is the same layer the composer (picker / paste / drop) routes through.
 *
 * @module @club/web/lib/upload
 */

/** Allowed image MIMEs — mirrors `@club/shared` `ImageMime` zod options. */
export const IMAGE_MIME_WHITELIST: readonly string[] = ImageMime.options;
/** Allowed video MIMEs — mirrors `@club/shared` `VideoMime` zod options. */
export const VIDEO_MIME_WHITELIST: readonly string[] = VideoMime.options;
/** Allowed document MIMEs — mirrors `@club/shared` `DocumentMime` zod options. */
export const DOCUMENT_MIME_WHITELIST: readonly string[] = DocumentMime.options;

/** Whether `mime` is an allowed image type. */
export function isAllowedImageMime(mime: string): boolean {
  return IMAGE_MIME_WHITELIST.includes(mime);
}

/** Whether `mime` is an allowed video type. */
export function isAllowedVideoMime(mime: string): boolean {
  return VIDEO_MIME_WHITELIST.includes(mime);
}

/** Whether `mime` is an allowed document type. */
export function isAllowedDocumentMime(mime: string): boolean {
  return DOCUMENT_MIME_WHITELIST.includes(mime);
}

/**
 * Human-readable byte string. Drops trailing `.0` (`24MB`, not `24.0MB`).
 * @example humanBytes(10_485_760) // "10MB"
 * @example humanBytes(10_737_418) // "10.2MB"
 */
export function humanBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)}KB`;
  }
  return `${bytes}B`;
}

/**
 * A localized reject reason the caller turns into text via `t()`.
 * @property key  - i18n key, e.g. `"image.invalidMime"` or `"video.tooLarge"`.
 * @property vars - Optional interpolation vars (e.g. `{ max, size }` for `tooLarge`).
 */
export type RejectReason = { key: string; vars?: Record<string, string | number> };

function validateAgainst(
  file: File,
  mimeWhitelist: readonly string[],
  maxBytes: number,
  keyPrefix: string
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

/** Validate `file` against the image whitelist and `MAX_IMAGE_BYTES`. */
export function validateImageFile(file: File): RejectReason | null {
  return validateAgainst(file, IMAGE_MIME_WHITELIST, MAX_IMAGE_BYTES, 'image');
}

/** Validate `file` against the video whitelist and `MAX_VIDEO_BYTES`. */
export function validateVideoFile(file: File): RejectReason | null {
  return validateAgainst(file, VIDEO_MIME_WHITELIST, MAX_VIDEO_BYTES, 'video');
}

/** Validate `file` against the document whitelist and `MAX_DOCUMENT_BYTES`. */
export function validateDocumentFile(file: File): RejectReason | null {
  return validateAgainst(file, DOCUMENT_MIME_WHITELIST, MAX_DOCUMENT_BYTES, 'document');
}

/**
 * Validate any media attachment by dispatching on its MIME type.
 * @param file - The File to validate.
 * @returns null when accepted, otherwise a reject reason the caller formats via
 *          `t(reason.key, reason.vars)`. Non-media files fall through to a
 *          document reject (the most permissive label).
 */
export function validateMediaFile(file: File): RejectReason | null {
  if (file.type.startsWith('video/')) return validateVideoFile(file);
  if (file.type.startsWith('image/')) return validateImageFile(file);
  return validateDocumentFile(file);
}

/** Extract only image files from an iterable of Files (e.g. a paste or drop). */
export function extractImageFiles(items: Iterable<File>): File[] {
  const out: File[] = [];
  for (const f of items) {
    if (f.type.startsWith('image/')) out.push(f);
  }
  return out;
}

/** Extract image OR video files from an iterable of Files. */
export function extractMediaFiles(items: Iterable<File>): File[] {
  const out: File[] = [];
  for (const f of items) {
    if (f.type.startsWith('image/') || f.type.startsWith('video/')) out.push(f);
  }
  return out;
}

/**
 * Extract all attachable files (image / video / document) from an iterable of
 * Files. This is the gate the composer's picker / paste / drop route through.
 * Documents are matched against `DOCUMENT_MIME_WHITELIST` by exact MIME (they
 * don't share a prefix).
 */
export function extractAttachmentFiles(items: Iterable<File>): File[] {
  const out: File[] = [];
  for (const f of items) {
    const m = f.type;
    if (
      m.startsWith('image/') ||
      m.startsWith('video/') ||
      (DOCUMENT_MIME_WHITELIST as readonly string[]).includes(m)
    ) {
      out.push(f);
    }
  }
  return out;
}

/** XHR factory used by `uploadImage`; overwritten by tests to mock the upload.
 *  @internal
 */
let createXHR: () => XMLHttpRequest = () => new XMLHttpRequest();

/**
 * Internal XHR factory so the upload path can be exercised in tests without
 * mocking a global constructor. Production code keeps the default, which just
 * returns a real XMLHttpRequest. Not for external use.
 * @internal
 */
export function _setCreateXHR(fn: () => XMLHttpRequest) {
  createXHR = fn;
}

/**
 * Upload `file` as a multipart POST to `POST {server}/files`.
 *
 * Returns the server's `UploadFileResponse` (structurally a `MessageAttachment`)
 * once the upload finishes. Progress is reported via `opts.onProgress` in bytes.
 * On failure throws `ClubApiError` with a message from the response body when
 * available, or a generic network/timeout message otherwise.
 *
 * @param conn - Active connection (the `key` is sent as `Authorization: Bearer`).
 * @param file - The File to upload.
 * @param opts - Optional `{ timeoutMs, onProgress }`. Default timeout is 30 s.
 * @returns The server's response describing the uploaded file.
 * @throws ClubApiError on network error, timeout (408), or server error.
 * @example
 * const att = await uploadImage(conn, pickedFile, { onProgress: (loaded, total) => ... });
 * const attId = att.id;  // pass into POST /messages
 */
export async function uploadImage(
  conn: ClubConn,
  file: File,
  opts: { timeoutMs?: number; onProgress?: (loaded: number, total: number) => void } = {}
): Promise<UploadFileResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const xhr = createXHR();
  const headers: Record<string, string> = {};
  if (conn.key) headers.Authorization = `Bearer ${conn.key}`;

  try {
    xhr.open('POST', `${conn.server}/files`);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);

    if (opts.onProgress) {
      const onProgress = opts.onProgress;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
    }

    const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      xhr.onerror = () => reject(new ClubApiError('network error', NETWORK_ERROR_STATUS));
      xhr.ontimeout = () => reject(new ClubApiError('upload timeout', 408));
      xhr.onabort = () => reject(new ClubApiError('upload timeout', 408));
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
      throw new ClubApiError(msg, parseHttpErrorStatus(res.status));
    }

    return JSON.parse(res.body) as MessageAttachment;
  } finally {
    clearTimeout(timer);
  }
}
