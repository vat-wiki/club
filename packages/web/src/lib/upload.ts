import { ImageMime, MAX_IMAGE_BYTES, type MessageAttachment, type UploadFileResponse } from "@club/shared";
import { ClubApiError, type ClubConn } from "@club/sdk";

// The MIME whitelist is the single source of truth in @club/shared (ImageMime).
// Pre-flight locally so a wrong-format pick is rejected before any bytes hit
// the network — the server re-checks authoritatively anyway.
export const IMAGE_MIME_WHITELIST: readonly string[] = ImageMime.options;

export function isAllowedImageMime(mime: string): boolean {
  return (IMAGE_MIME_WHITELIST as readonly string[]).includes(mime);
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

// Validate a single candidate image file against the shared limits. Returns
// null when accepted, or a localized reject reason when rejected. Pure (no
// network, no i18n dependency) — the caller turns the reason into text via t().
export function validateImageFile(file: File): RejectReason | null {
  if (!isAllowedImageMime(file.type)) {
    return { key: "image.invalidMime" };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return {
      key: "image.tooLarge",
      vars: { max: humanBytes(MAX_IMAGE_BYTES), size: humanBytes(file.size) },
    };
  }
  return null;
}

// Pull image files out of a DataTransferItemList / FileList, ignoring
// non-image items. Used by paste + drop handlers.
export function extractImageFiles(items: Iterable<File>): File[] {
  const out: File[] = [];
  for (const f of items) {
    if (f.type.startsWith("image/")) out.push(f);
  }
  return out;
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

  try {
    const headers: Record<string, string> = {};
    if (conn.key) headers.Authorization = `Bearer ${conn.key}`;

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${conn.server}/files`);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);

    if (opts.onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) opts.onProgress!(e.loaded, e.total);
      };
    }

    const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      xhr.onerror = () => reject(new ClubApiError("network error", 0));
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
      throw new ClubApiError(msg, res.status);
    }

    return JSON.parse(res.body) as MessageAttachment;
  } finally {
    clearTimeout(timer);
  }
}
