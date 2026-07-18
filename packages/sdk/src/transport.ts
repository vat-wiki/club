import type {
  CreateMessageRequest,
  CreateParticipantRequest,
  CreateParticipantResponse,
  ListMessagesQuery,
  Mention,
  Message,
  Participant,
  RecoverParticipantRequest,
  RecoverParticipantResponse,
  Reaction,
  Room,
  UploadFileResponse,
} from "@club/shared";
import {
  ClubApiError,
  formatError,
  shouldRetry,
  jitteredBackoff,
  sleep,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
} from "@club/shared";

// ── Connection ──────────────────────────────────────────────────────
// key is optional: createParticipant() needs no auth, so a client can be
// built with just { server } to mint a key, then rebuilt with that key.
export interface ClubConn {
  server: string; // base URL, e.g. http://localhost:6200
  key?: string; // club_<...> bearer token (legacy keys may carry a club_human_/club_agent_ prefix)
}

export interface CallOpts {
  timeoutMs?: number;
  retries?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;

function authHeaders(c: ClubConn): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (c.key) h.Authorization = `Bearer ${c.key}`;
  return h;
}

// ── Response handling ───────────────────────────────────────────────
async function check<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* ignore non-JSON error bodies */
    }
    throw new ClubApiError(msg, res.status);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

// ── Retry / timeout policy ──────────────────────────────────────────
// Delegated to @club/shared utilities for consistency across SDK and
// any other consumer (CLI, MCP, web).

function wrapErr(err: unknown): ClubApiError {
  if (err instanceof ClubApiError) return err;
  if (err instanceof Error && err.name === "AbortError") {
    return new ClubApiError("request timeout", 408);
  }
  return new ClubApiError(formatError(err), 0);
}

export interface RequestOptions extends CallOpts {
  method?: string;
  /** JSON-serializable request body. */
  body?: Jsonable;
}

/** JSON-serializable values accepted as `RequestOptions.body`. */
type Jsonable =
  | string
  | number
  | boolean
  | null
  | undefined
  | Jsonable[]
  | { [k: string]: Jsonable };

// Core request: typed JSON over fetch, with per-request timeout and retry on
// transient failures (network errors / timeouts / 429 / 5xx) for idempotent
// GETs only.
export async function request<T>(
  c: ClubConn,
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const method = opts.method ?? "GET";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // POSTs and other non-GETs are never retried.
  const maxRetries = method === "GET" ? opts.retries ?? DEFAULT_RETRIES : 0;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(jitteredBackoff(attempt - 1));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${c.server}${path}`, {
        method,
        headers: authHeaders(c),
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (shouldRetry(method, res.status) && attempt < maxRetries) continue;
      return await check<T>(res);
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      const transient =
        (err as Error)?.name === "AbortError" || err instanceof TypeError;
      if (!(method === "GET" && transient && attempt < maxRetries)) {
        throw wrapErr(err);
      }
      // transient failure on an idempotent read with retries left → loop
    }
  }
  throw wrapErr(lastErr);
}

// ── REST endpoints ──────────────────────────────────────────────────

export async function getMe(c: ClubConn, opts: CallOpts = {}): Promise<Participant> {
  return request<Participant>(c, "/me", opts);
}

export async function listMessages(
  c: ClubConn,
  opts: ListMessagesQuery & CallOpts = {},
): Promise<Message[]> {
  const params = new URLSearchParams();
  if (opts.since) params.set("since", opts.since);
  if (opts.before) params.set("before", opts.before);
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.room) params.set("room", opts.room);
  const { since: _s, before: _b, limit: _l, room: _r, ...callOpts } = opts;
  const qs = params.toString();
  return request<Message[]>(c, `/messages${qs ? "?" + qs : ""}`, callOpts);
}

export async function sendMessage(
  c: ClubConn,
  content: string,
  opts: { attachmentIds?: string[]; replyToId?: string; room?: string; timeoutMs?: number } = {},
): Promise<Message> {
  // Backward compatible: when no attachmentIds/replyToId/room are supplied the
  // body is just { content } exactly as before. With any, the body carries them.
  const body: Partial<CreateMessageRequest> = { content };
  if (opts.attachmentIds && opts.attachmentIds.length > 0) {
    body.attachmentIds = opts.attachmentIds;
  }
  if (opts.replyToId) {
    body.replyToId = opts.replyToId;
  }
  if (opts.room) {
    body.room = opts.room;
  }
  return request<Message>(c, "/messages", {
    method: "POST",
    body,
    timeoutMs: opts.timeoutMs,
  });
}

// GET /messages/search?q=&room=&limit= — substring search, newest first. `room`
// is optional: omit to search across all rooms, pass a slug to scope it.
export async function searchMessages(
  c: ClubConn,
  opts: { q: string; room?: string; limit?: number } & CallOpts,
): Promise<Message[]> {
  const params = new URLSearchParams();
  params.set("q", opts.q);
  if (opts.room) params.set("room", opts.room);
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  const { q: _q, room: _r, limit: _l, ...callOpts } = opts;
  return request<Message[]>(c, `/messages/search?${params.toString()}`, callOpts);
}

// ── File upload (multipart) ────────────────────────────────────────
// The core `request()` is JSON-only (it JSON.stringifies every body), so a
// multipart upload can't go through it. This builds a FormData body the same
// way the web client does (packages/web/src/lib/upload.ts), but accepts a Node
// Buffer instead of a browser File so the CLI and MCP can use it. Auth mirrors
// the transport: a Bearer header when a key is present. The server is the
// authoritative mime/size checker, but callers should still pre-flight locally
// (see packages/cli / packages/mcp) to avoid uploading bytes that are doomed
// to be rejected.
export interface UploadFileInput {
  /** Raw file bytes. */
  buffer: Buffer | Uint8Array;
  /** Filename hint sent as the multipart part's filename. */
  filename: string;
  /** MIME type sent as the part's Content-Type (must be in AttachmentMime). */
  mime: string;
}

// Client-side upload limits. These should match or be slightly more conservative
// than the server limits to avoid uploading bytes that will be rejected.
// Single source of truth: @club/shared constants — never duplicate here.

function getMaxLengthForMime(mime: string): number {
  if (mime.startsWith("video/")) return MAX_VIDEO_BYTES;
  if (mime.startsWith("image/")) return MAX_IMAGE_BYTES;
  // Documents and unknown types default to document limit.
  return MAX_DOCUMENT_BYTES;
}

// GET /files/:id — fetch file content as ArrayBuffer. Useful for agents
// to read files uploaded by others. Returns raw bytes; caller decodes by mime.
export async function getFile(
  c: ClubConn,
  id: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ buffer: ArrayBuffer; mime: string; filename?: string }> {
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {};
    if (c.key) headers.Authorization = `Bearer ${c.key}`;

    const res = await fetch(`${c.server}/files/${encodeURIComponent(id)}`, {
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) msg = body.error;
      } catch {
        /* ignore non-JSON error bodies */
      }
      throw new ClubApiError(msg, res.status);
    }
    const buffer = await res.arrayBuffer();
    const mime = res.headers.get("content-type") || "application/octet-stream";
    // Content-Disposition may contain original filename: "attachment; filename=\"foo.pdf\""
    const contentDisposition = res.headers.get("content-disposition");
    let filename: string | undefined;
    if (contentDisposition) {
      const m = /filename=(?:"([^"]*)"|([^;]*))/.exec(contentDisposition);
      if (m) filename = m[1] || m[2];
    }
    return { buffer, mime, filename };
  } catch (err) {
    throw wrapErr(err);
  } finally {
    clearTimeout(timer);
  }
}

export async function uploadFile(
  c: ClubConn,
  input: UploadFileInput,
  opts: { timeoutMs?: number } = {},
): Promise<UploadFileResponse> {
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Pre-flight size check: fail fast if the buffer exceeds the limit for its MIME type.
    // This prevents wasting bandwidth on uploads the server will reject.
    const maxLength = getMaxLengthForMime(input.mime);
    if (input.buffer.byteLength > maxLength) {
      throw new ClubApiError(
        `file size (${input.buffer.byteLength} bytes) exceeds limit for ${input.mime} (${maxLength} bytes)`,
        413,
      );
    }

    const headers: Record<string, string> = {};
    if (c.key) headers.Authorization = `Bearer ${c.key}`;

    const form = new FormData();
    // Blob is available in Node 18+ and carries the mime + a content-length;
    // wrapping the bytes in a Blob lets fetch set the part headers without us
    // hand-rolling a multipart body. Copy into a fresh Uint8Array backed by a
    // plain ArrayBuffer so it satisfies the DOM BlobPart type regardless of
    // whether the caller passed a Node Buffer (which TS 5.7 types over
    // ArrayBufferLike, incompatible with BlobPart's ArrayBuffer-backed view).
    const bytes = new Uint8Array(input.buffer.byteLength);
    bytes.set(input.buffer);
    const blob = new Blob([bytes], { type: input.mime });
    form.append("file", blob, input.filename);

    const res = await fetch(`${c.server}/files`, {
      method: "POST",
      headers,
      body: form,
      signal: controller.signal,
    });
    return await check<UploadFileResponse>(res);
  } catch (err) {
    throw wrapErr(err);
  } finally {
    clearTimeout(timer);
  }
}

export async function listMembers(c: ClubConn, opts: CallOpts = {}): Promise<Participant[]> {
  return request<Participant[]>(c, "/members", opts);
}

// GET /me/mentions — the authenticated participant's UNREAD @-mentions, oldest
// first. This is the "inbox" an agent polls when it wakes up: anything here
// happened while it was offline (or otherwise uncaught by a live listen).
export async function listMentions(
  c: ClubConn,
  opts: CallOpts = {},
): Promise<Mention[]> {
  return request<Mention[]>(c, "/me/mentions", opts);
}

// POST /me/mentions/:id/read — mark one mention as read. Returns the updated
// Mention. Throws ClubApiError(404) if no such mention belongs to the caller,
// or ClubApiError(409) if it was already read.
export async function markMentionRead(
  c: ClubConn,
  id: string,
  opts: { timeoutMs?: number } = {},
): Promise<Mention> {
  return request<Mention>(c, `/me/mentions/${encodeURIComponent(id)}/read`, {
    method: "POST",
    ...opts,
  });
}

// Mint a participant + single-use key. Unauthenticated (POST /participants);
// accepts a connection with no key so callers can bootstrap.
export async function createParticipant(
  c: Pick<ClubConn, "server">,
  input: CreateParticipantRequest,
  opts: { timeoutMs?: number } = {},
): Promise<CreateParticipantResponse> {
  return request<CreateParticipantResponse>(c, "/participants", {
    method: "POST",
    body: input,
    ...opts,
  });
}

// Recover an existing identity by callsign + one-time recovery code. Rotates
// both the key and the recovery code, reusing the original id + name.
// Unauthenticated (no valid key to send); throws ClubApiError(401) on any
// failure (unknown name, wrong code, or no recovery code armed) — the server
// deliberately does not distinguish these to prevent callsign enumeration.
export async function recoverParticipant(
  c: Pick<ClubConn, "server">,
  input: RecoverParticipantRequest,
  opts: { timeoutMs?: number } = {},
): Promise<RecoverParticipantResponse> {
  return request<RecoverParticipantResponse>(c, "/participants/recover", {
    method: "POST",
    body: input,
    ...opts,
  });
}

// ── Agent thinking presence (P1-5) ───────────────────────────────────
//
// An agent reports its own "I'm processing a @mention" / "I'm done" state; the
// server relays it to every SSE subscriber as a named event (agent_thinking /
// agent_idle) so the room can show a typing indicator. The participant is taken
// from the authed key, so the body is empty. Both endpoints return 204.
//
// Contract for callers:
//   - report thinking ONCE when you start handling a mention;
//   - if your work may exceed the server's thinking TTL (~45s), RE-REPORT on a
//     cadence shorter than the TTL to refresh it — the server dedupes re-
//     reports (no SSE re-broadcast), so the indicator won't flicker;
//   - report idle (or just POST your reply) when done.
// The TTL is a *lost-contact fallback* (crash/kill/silent-error), NOT a reply
// budget — a long-but-healthy reply must re-report to avoid having its
// indicator yanked mid-thought. The server also auto-clears thinking the moment
// an agent's reply message lands, and reaps entries past TTL, so a missed idle
// never sticks the indicator on forever.

export async function reportAgentThinking(
  c: ClubConn,
  opts: { room?: string; timeoutMs?: number } = {},
): Promise<void> {
  const body = opts.room ? { room: opts.room } : {};
  await request<null>(c, "/agents/thinking", { method: "POST", body, ...opts });
}

export async function reportAgentIdle(
  c: ClubConn,
  opts: { room?: string; timeoutMs?: number } = {},
): Promise<void> {
  const body = opts.room ? { room: opts.room } : {};
  await request<null>(c, "/agents/idle", { method: "POST", body, ...opts });
}

// ── Rooms (multi-room) ──────────────────────────────────────────────

// GET /rooms — every room, general first then most-recently-active first. Each
// room carries lastActivityAt (null when empty) so clients can sort unread/
// active-first without a second round-trip.
export async function listRooms(c: ClubConn, opts: CallOpts = {}): Promise<Room[]> {
  return request<Room[]>(c, "/rooms", opts);
}

// POST /rooms { name } — create/ensure a room exists. Idempotent: posting an
// existing slug returns that room without error. `name` is the canonical slug.
export async function createRoom(
  c: ClubConn,
  name: string,
  opts: { timeoutMs?: number } = {},
): Promise<Room> {
  return request<Room>(c, "/rooms", { method: "POST", body: { name }, ...opts });
}

// ── Message actions (delete, react) ────────────────────────────────────

// DELETE /messages/:id — soft-delete (recall) a message. Only the author may.
// Returns 204 on success, 404 if not found or not yours.
export async function deleteMessage(
  c: ClubConn,
  id: string,
  opts: { timeoutMs?: number } = {},
): Promise<void> {
  await request<null>(c, `/messages/${encodeURIComponent(id)}`, {
    method: "DELETE",
    ...opts,
  });
}

// POST /messages/:id/reactions { emoji } — toggle a reaction. Adds if absent,
// removes if present. Broadcasts the refreshed aggregate to all subscribers.
// Returns the updated reaction list [{ emoji, count }].
// NOTE: Reaction type is imported from @club/shared.

export async function toggleMessageReaction(
  c: ClubConn,
  id: string,
  emoji: string,
  opts: { timeoutMs?: number } = {},
): Promise<Reaction[]> {
  return request<Reaction[]>(c, `/messages/${encodeURIComponent(id)}/reactions`, {
    method: "POST",
    body: { emoji },
    ...opts,
  });
}
