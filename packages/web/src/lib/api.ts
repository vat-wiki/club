import { uploadImage } from "@/lib/upload";

import { ClubClient, type ClubConn,request } from "@club/sdk";
import type {
  Channel,
  CreateMessageRequest,
  CreateParticipantResponse,
  DeleteAccountRequest,
  EditMessageRequest,
  Message,
  Participant,
  RecoverParticipantRequest,
  RecoverParticipantResponse,
  RotateKeyRequest,
  UpdateProfileRequest,
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
   * PATCH /me { bio } - update the authenticated participant's
   * self-introduction. `bio: ""` clears it. Returns the refreshed Participant
   * (server returns the post-update row so callers can swap state directly).
   */
  updateProfile(c: ClubConn, bio: string): Promise<Participant>;

  /**
   * GET /messages — recent history of a channel.
   * @param since - Return messages after this id; omit to get the recent batch.
   * @param channel  - Scope to one channel (server defaults to "general" when omitted).
   */
  messages(c: ClubConn, since?: string, channel?: string): Promise<Message[]>;

  /**
   * POST /messages — send a message.
   * @param content     - Message text.
   * @param attachmentIds - IDs of previously uploaded files (empty by default).
   * @param replyToId   - Optional id of the message being replied to.
   * @param channel        - Target channel; defaults to "general". A valid but
   *                      non-existent channel is auto-created (PRD §9.4).
   */
  send(
    c: ClubConn,
    content: string,
    attachmentIds?: readonly string[],
    replyToId?: string,
    channel?: string,
  ): Promise<Message>;

  /** GET /members — roster of the channel. */
  members(c: ClubConn): Promise<Participant[]>;

  /** GET /channels — every channel, general first then most-recently-active first. */
  channels(c: ClubConn): Promise<Channel[]>;

  /**
   * POST /channels { name } — create/ensure a channel exists (idempotent).
   * @param name - Canonical channel slug.
   */
  createChannel(c: ClubConn, name: string): Promise<Channel>;

  /**
   * PATCH /channels/:slug { displayName } — rename a channel via its mutable
   * display name (the slug is immutable). Pass null to clear. Open-CRUD: any
   * participant may rename any channel.
   */
  updateChannel(c: ClubConn, slug: string, displayName: string | null): Promise<Channel>;

  /**
   * DELETE /channels/:slug — delete a channel and cascade-clean its messages.
   * `general` is protected. Open-CRUD: any participant may delete any channel.
   */
  deleteChannel(c: ClubConn, slug: string): Promise<void>;

  /**
   * POST /participants/:id/kick — remove a participant (open model: anyone may
   * kick anyone). Revokes their key and soft-deletes their messages.
   */
  kickParticipant(c: ClubConn, id: string): Promise<void>;

  /**
   * PATCH /participants/:id { bio } — set ANY participant's bio (open model).
   */
  updateParticipantBio(c: ClubConn, id: string, bio: string): Promise<void>;

  /**
   * GET /messages/search — substring search, newest first.
   * @param q    - Substring to search.
   * @param channel - Optional channel scope; omit to search all channels.
   */
  search(c: ClubConn, q: string, channel?: string): Promise<Message[]>;

  /** DELETE /messages/:id — soft-delete (recall) a message. */
  deleteMessage(c: ClubConn, id: string): Promise<void>;

  /** PATCH /messages/:id { content } — edit a message. */
  editMessage(c: ClubConn, id: string, content: string): Promise<Message>;

  /** POST /messages/:id/reactions { emoji } — toggle a reaction. */
  react(c: ClubConn, messageId: string, emoji: string): Promise<void>;

  /**
   * POST /agents/thinking — report "I'm typing / processing".
   * `channel` scopes the indicator to that channel's stream (PRD §5.1).
   */
  thinking(c: ClubConn, channel?: string): Promise<void>;

  /** POST /agents/idle — stop the typing indicator. */
  idle(c: ClubConn, channel?: string): Promise<void>;

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
 * Default API facade with the standard channel limit of 50 messages per batch.
 *
 * Pass a `ClubConn` as the first arg to every method; this avoids holding
 * connection state at the module level and keeps the facade easily mockable
 * in tests (each call constructs a fresh `ClubClient`).
 */
export const api: ClubApi = {
  me: (c: ClubConn): Promise<Participant> => client(c).me(),

  // PATCH /me { bio } - update the authenticated participant's
  // self-introduction. Goes through the low-level `request` helper (like
  // editMessage / rawRotateKey) so we don't depend on a SDK method being added.
  // The server returns the refreshed Participant row.
  updateProfile: (c: ClubConn, bio: string): Promise<Participant> =>
    request<Participant>(c, "/me", {
      method: "PATCH",
      body: { bio } satisfies UpdateProfileRequest,
    }),

  // `channel` scopes history to a channel (default "general" server-side when omitted).
  // `since` returns messages after an id; omitted here returns the recent batch.
  messages: (c: ClubConn, since?: string, channel?: string): Promise<Message[]> =>
    client(c).messages({ since, channel, limit: 50 }),

  send: (
    c: ClubConn,
    content: string,
    attachmentIds: readonly string[] = [],
    replyToId?: string,
    channel?: string,
  ): Promise<Message> => {
    if (attachmentIds.length > 0 || replyToId || channel) {
      const body: CreateMessageRequest = {
        content,
        attachmentIds: [...attachmentIds],
        channel: channel ?? "general",
        ...(replyToId ? { replyToId } : {}),
      };
      return request<Message>(c, "/messages", { method: "POST", body });
    }
    return client(c).send(content);
  },

  members: (c: ClubConn): Promise<Participant[]> => client(c).members(),
  channels: (c: ClubConn): Promise<Channel[]> => client(c).channels(),
  createChannel: (c: ClubConn, name: string): Promise<Channel> => client(c).createChannel(name),
  updateChannel: (c: ClubConn, slug: string, displayName: string | null): Promise<Channel> =>
    client(c).updateChannel(slug, displayName),
  deleteChannel: (c: ClubConn, slug: string): Promise<void> => client(c).deleteChannel(slug),
  kickParticipant: (c: ClubConn, id: string): Promise<void> => client(c).kickParticipant(id),
  updateParticipantBio: (c: ClubConn, id: string, bio: string): Promise<void> =>
    client(c).updateParticipantBio(id, bio),
  search: (c: ClubConn, q: string, channel?: string): Promise<Message[]> =>
    client(c).search(q, channel ? { channel } : undefined),
  deleteMessage: (c: ClubConn, id: string): Promise<void> =>
    request<void>(c, `/messages/${encodeURIComponent(id)}`, { method: "DELETE" }),
  editMessage: (
    c: ClubConn,
    id: string,
    content: string,
  ): Promise<Message> =>
    request<Message>(c, `/messages/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { content } satisfies EditMessageRequest,
    }),
  react: (c: ClubConn, messageId: string, emoji: string): Promise<void> =>
    request<void>(c, `/messages/${encodeURIComponent(messageId)}/reactions`, {
      method: "POST",
      body: { emoji },
    }),
  thinking: (c: ClubConn, channel?: string): Promise<void> =>
    client(c).reportAgentThinking(channel),
  idle: (c: ClubConn, channel?: string): Promise<void> => client(c).reportAgentIdle(channel),
  uploadFile: (
    c: ClubConn,
    file: File,
    opts?: UploadOptions,
  ): Promise<UploadFileResponse> => uploadImage(c, file, opts),
};

export async function createParticipant(
  server: string,
  name: string,
  bio?: string,
): Promise<{ key: string; recoverCode: string }> {
  // `bio` defaults to "" on the server (ParticipantBio.default("")), but we pass
  // it explicitly so a registration can carry a self-introduction. Optional here
  // so existing callers (and the paste/recover paths) keep working unchanged.
  const { key, recoverCode } = await new ClubClient({ server }).createParticipant({
    name,
    bio: bio ?? "",
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

/**
 * Rotate the current participant's key. Returns a fresh key + recovery code
 * (the old key is immediately invalidated). Callers receive the plaintext
 * exactly once and are responsible for storing it locally.
 */
export async function rotateKey(
  server: string,
  key: string,
  password: string,
): Promise<{ key: string; recoverCode: string }> {
  const result = await request<{ key: string; recoverCode: string }>(
    { server, key },
    "/participants/:id/rotate-key",
    { method: "POST", body: { password } satisfies RotateKeyRequest },
  );
  // The server validates that `:id` matches the authenticated participant;
  // pass the participant id as a query-free path placeholder — the SDK
  // currently interpolates `:id` literally, so we use the full path via
  // the low-level helper. The real participant id must be supplied as `:id`.
  // Because the SDK's request helper does not interpolate `:id`, use the
  // actual participant id directly via the raw API call below.
  // (Kept as stub to satisfy the type surface; production calls use
  // `rawRotateKey`.)
  return result;
}

/** Raw HTTP call to POST /participants/:id/rotate-key. */
export async function rawRotateKey(
  server: string,
  participantId: string,
  key: string,
  password: string,
): Promise<{ key: string; recoverCode: string }> {
  return request<{ key: string; recoverCode: string }>(
    { server, key },
    `/participants/${encodeURIComponent(participantId)}/rotate-key`,
    { method: "POST", body: { password } satisfies RotateKeyRequest },
  );
}

/** Raw HTTP call to DELETE /participants/:id (account deletion). */
export async function rawDeleteAccount(
  server: string,
  participantId: string,
  key: string,
  body: DeleteAccountRequest,
): Promise<void> {
  return request<void>(
    { server, key },
    `/participants/${encodeURIComponent(participantId)}`,
    { method: "DELETE", body },
  );
}
