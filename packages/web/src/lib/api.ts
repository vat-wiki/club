import { uploadImage } from "@/lib/upload";

import { ClubClient, type ClubConn,request } from "@club/sdk";
import type {
  CreateMessageRequest,
  CreateParticipantResponse,
  Message,
  Participant,
  RecoverParticipantRequest,
  RecoverParticipantResponse,
  Room,
  UploadFileResponse,
} from "@club/shared";

// ── Shared types ────────────────────────────────────────────────────

/** Optional upload progress callback signature */
export type UploadProgressCb = (loaded: number, total: number) => void;

/** Optional parameters for file uploads */
export interface UploadOptions {
  /** Request timeout in ms; defaults to the SDK's 15 000 ms. */
  timeoutMs?: number;
  /** Per-chunk progress callback. `loaded` / `total` are in bytes. */
  onProgress?: UploadProgressCb;
}

// ── Facade interface ───────────────────────────────────────────────

/**
 * The thin API facade the web UI imports from. Every method is typed so the
 * compiler catches mismatched calls (wrong arg order, missing required params,
 * dropped return types) and callers get IDE autocomplete instead of guessing
 * the shape of `@club/sdk`'s methods.
 */
export interface ClubApi {
  /** GET /me — the participant the current key belongs to. */
  me(c: ClubConn): Promise<Participant>;

  /**
   * GET /messages — recent history of a room.
   * @param since - Return messages after this id; omit to get the recent batch.
   * @param room  - Scope to one room (server defaults to "general" when omitted).
   */
  messages(c: ClubConn, since?: string, room?: string): Promise<Message[]>;

  /**
   * POST /messages — send a message.
   * @param content     - Message text.
   * @param attachmentIds - IDs of previously uploaded files (empty by default).
   * @param replyToId   - Optional id of the message being replied to.
   * @param room        - Target room; defaults to "general". A valid but
   *                      non-existent room is auto-created (PRD §9.4).
   */
  send(
    c: ClubConn,
    content: string,
    attachmentIds?: readonly string[],
    replyToId?: string,
    room?: string,
  ): Promise<Message>;

  /** GET /members — roster of the room. */
  members(c: ClubConn): Promise<Participant[]>;

  /** GET /rooms — every room, general first then most-recently-active first. */
  rooms(c: ClubConn): Promise<Room[]>;

  /**
   * POST /rooms { name } — create/ensure a room exists (idempotent).
   * @param name - Canonical room slug.
   */
  createRoom(c: ClubConn, name: string): Promise<Room>;

  /**
   * GET /messages/search — substring search, newest first.
   * @param q    - Substring to search.
   * @param room - Optional room scope; omit to search all rooms.
   */
  search(c: ClubConn, q: string, room?: string): Promise<Message[]>;

  /** DELETE /messages/:id — soft-delete (recall) a message. */
  deleteMessage(c: ClubConn, id: string): Promise<void>;

  /** POST /messages/:id/reactions { emoji } — toggle a reaction. */
  react(c: ClubConn, messageId: string, emoji: string): Promise<void>;

  /**
   * POST /agents/thinking — report "I'm typing / processing".
   * `room` scopes the indicator to that room's stream (PRD §5.1).
   */
  thinking(c: ClubConn, room?: string): Promise<void>;

  /** POST /agents/idle — stop the typing indicator. */
  idle(c: ClubConn, room?: string): Promise<void>;

  /**
   * POST /files (multipart) — upload an image/video/document.
   * The returned attachment `id` is later echoed via `send()`.
   */
  uploadFile(
    c: ClubConn,
    file: File,
    opts?: UploadOptions,
  ): Promise<UploadFileResponse>;
}

// ── Implementation ─────────────────────────────────────────────────

// Thin facade over ClubClient so components import from one place. The real
// HTTP/SSE logic lives in @club/sdk's ClubClient; this just constructs a client
// per call from the connection the app holds.
function client(c: ClubConn): ClubClient {
  return new ClubClient(c);
}

/**
 * Default API facade with the standard room limit of 50 messages per batch.
 *
 * Pass a `ClubConn` as the first arg to every method; this avoids holding
 * connection state at the module level and keeps the facade easily mockable
 * in tests (each call constructs a fresh `ClubClient`).
 */
export const api: ClubApi = {
  me: (c: ClubConn): Promise<Participant> => client(c).me(),

  // `room` scopes history to a room (default "general" server-side when omitted).
  // `since` returns messages after an id; omitted here returns the recent batch.
  messages: (c: ClubConn, since?: string, room?: string): Promise<Message[]> =>
    client(c).messages({ since, room, limit: 50 }),

  send: (
    c: ClubConn,
    content: string,
    attachmentIds: readonly string[] = [],
    replyToId?: string,
    room?: string,
  ): Promise<Message> => {
    if (attachmentIds.length > 0 || replyToId || room) {
      const body: CreateMessageRequest = {
        content,
        attachmentIds: [...attachmentIds],
        room: room ?? "general",
        ...(replyToId ? { replyToId } : {}),
      };
      return request<Message>(c, "/messages", { method: "POST", body });
    }
    return client(c).send(content);
  },

  members: (c: ClubConn): Promise<Participant[]> => client(c).members(),
  rooms: (c: ClubConn): Promise<Room[]> => client(c).rooms(),
  createRoom: (c: ClubConn, name: string): Promise<Room> => client(c).createRoom(name),
  search: (c: ClubConn, q: string, room?: string): Promise<Message[]> =>
    client(c).search(q, room ? { room } : undefined),
  deleteMessage: (c: ClubConn, id: string): Promise<void> =>
    request<void>(c, `/messages/${encodeURIComponent(id)}`, { method: "DELETE" }),
  react: (c: ClubConn, messageId: string, emoji: string): Promise<void> =>
    request<void>(c, `/messages/${encodeURIComponent(messageId)}/reactions`, {
      method: "POST",
      body: { emoji },
    }),
  thinking: (c: ClubConn, room?: string): Promise<void> =>
    client(c).reportAgentThinking(room),
  idle: (c: ClubConn, room?: string): Promise<void> => client(c).reportAgentIdle(room),
  uploadFile: (
    c: ClubConn,
    file: File,
    opts?: UploadOptions,
  ): Promise<UploadFileResponse> => uploadImage(c, file, opts),
};

export async function createParticipant(
  server: string,
  name: string,
): Promise<{ key: string; recoverCode: string }> {
  const { key, recoverCode } = await new ClubClient({ server }).createParticipant({
    name,
  });
  return { key, recoverCode };
}

/**
 * Recover an existing identity by callsign + one-time recovery code.
 *
 * Calls POST /participants/recover directly via the SDK's `request` helper
 * instead of `ClubClient.recover` — the SDK client method is being added in
 * parallel by the backend owner; going through `request` keeps us out of
 * `packages/sdk/src` while still using the shared contract types.
 *
 * @param server - Base URL of the club server.
 * @param input  - `{ name, recoverCode }` payload.
 * @returns Fresh `{ key, recoverCode, participant }` on success.
 */
export async function recoverParticipant(
  server: string,
  input: RecoverParticipantRequest,
): Promise<RecoverParticipantResponse> {
  // POST /participants/recover is unauthenticated (like /participants); we
  // pass an empty key so authHeaders() sends no Bearer header. `request` is
  // typed to require a full ClubConn, but only `server` is read on the wire.
  return request<RecoverParticipantResponse>(
    { server, key: "" },
    "/participants/recover",
    { method: "POST", body: input },
  );
}

export type { CreateParticipantResponse };
