import type {
  CreateParticipantRequest,
  CreateParticipantResponse,
  ListMessagesQuery,
  Mention,
  Message,
  Participant,
  Reaction,
  RecoverParticipantRequest,
  RecoverParticipantResponse,
  Room,
  UploadFileResponse,
} from "@club/shared";

import { type FileFormatTag } from "./file-parser.js";
import { type StreamHandle, streamMessages, type StreamOptions } from "./stream.js";
import {
  type CallOpts,
  type ClubConn,
  createParticipant as createParticipantFn,
  createRoom as createRoomFn,
  deleteMessage as deleteMessageFn,
  getFile,
  getMe,
  listMembers,
  listMentions,
  listMessages,
  listRooms as listRoomsFn,
  markMentionRead,
  markMentionsRead,
  recoverParticipant as recoverParticipantFn,
  reportAgentIdle as reportAgentIdleFn,
  reportAgentThinking as reportAgentThinkingFn,
  searchMessages as searchMessagesFn,
  sendMessage,
  toggleMessageReaction as toggleMessageReactionFn,
  uploadFile,
  type UploadFileInput,
} from "./transport.js";

/** Parse result returned by `ClubClient#readFileContent`. */
export interface ParsedFile {
  /** Parsed text content suitable for agent consumption. */
  text: string;
  /** Source format tag (closed union — see {@link FileFormatTag}). */
  format: FileFormatTag;
  /** MIME type reported by the server. */
  mime: string;
  /** Original filename if present. */
  filename?: string;
  /** Optional metadata (title, author, pages, sheets) when the parser provides it. */
  metadata?: {
    title?: string;
    author?: string;
    subject?: string;
    pages?: number;
    sheets?: string[];
  };
}

// ── ClubClient ──────────────────────────────────────────────────────
// A stateful handle over the transport functions: holds the connection
// config so callers don't thread it through every call. Methods delegate to
// the function layer, which remains the reusable core for non-OOP callers.
//
// `key` is optional: construct with just { server } to mint a participant,
// then rebuild with the returned key for authenticated calls.

export interface ClubClientOptions {
  server: string;
  key?: string;
  /** Per-request timeout (default 15s). */
  timeoutMs?: number;
  /** Max retries on transient failures for idempotent GETs (default 2). */
  retries?: number;
}

export class ClubClient {
  readonly server: string;
  readonly key?: string;
  private readonly timeoutMs?: number;
  private readonly retries?: number;

  constructor(opts: ClubClientOptions) {
    this.server = opts.server;
    this.key = opts.key;
    this.timeoutMs = opts.timeoutMs;
    this.retries = opts.retries;
  }

  private conn(): ClubConn {
    return { server: this.server, key: this.key };
  }

  private callOpts(): CallOpts {
    return { timeoutMs: this.timeoutMs, retries: this.retries };
  }

  /** GET /me — the participant this key belongs to. */
  me(): Promise<Participant> {
    return getMe(this.conn(), this.callOpts());
  }

  /** GET /members — roster of the room. */
  members(): Promise<Participant[]> {
    return listMembers(this.conn(), this.callOpts());
  }

  /** GET /rooms — every room, general first then most-recently-active first.
   *  Each room carries `lastActivityAt` (null when empty) so a client can sort
   *  unread/active-first. There is no server-side read state. */
  rooms(): Promise<Room[]> {
    return listRoomsFn(this.conn(), this.callOpts());
  }

  /** POST /rooms { name } — create/ensure a room exists (idempotent). `name`
   *  is the canonical slug. Returns the room (newly created or pre-existing). */
  createRoom(name: string): Promise<Room> {
    return createRoomFn(this.conn(), name, { timeoutMs: this.timeoutMs });
  }

  /** GET /me/mentions — the caller's UNREAD @-mentions, oldest first. */
  mentions(): Promise<Mention[]> {
    return listMentions(this.conn(), this.callOpts());
  }

  /** POST /me/mentions/:id/read — mark one mention as read. */
  markMentionRead(id: string): Promise<Mention> {
    return markMentionRead(this.conn(), id, { timeoutMs: this.timeoutMs });
  }

  /** POST /me/mentions/read — batch-mark mentions as read in a single request.
   *  Returns the updated Mention rows for the IDs that were actually unread. */
  markMentionsRead(ids: string[]): Promise<Mention[]> {
    return markMentionsRead(this.conn(), ids, { timeoutMs: this.timeoutMs });
  }

  /** GET /messages — recent history of a room; `since` returns messages after
   *  an id, `before` returns older messages before an id (scroll-up pagination).
   *  `room` scopes to a room (default "general" server-side when omitted). */
  messages(opts: ListMessagesQuery = {}): Promise<Message[]> {
    return listMessages(this.conn(), { ...opts, ...this.callOpts() });
  }

  /** POST /messages — send a message as the authenticated participant.
   *  `attachmentIds` references files previously uploaded via `uploadFile`;
   *  when omitted the body is the legacy `{ content }` shape. Pass an empty
   *  content with attachmentIds to send an image-only message. `opts.room`
   *  posts into a specific room (default "general"); `opts.replyToId` quotes a
   *  message. Posting into a non-existent-but-valid room auto-creates it. */
  send(
    content: string,
    attachmentIds?: string[],
    opts?: { room?: string; replyToId?: string },
  ): Promise<Message> {
    return sendMessage(this.conn(), content, {
      ...(attachmentIds && attachmentIds.length > 0 ? { attachmentIds } : {}),
      ...(opts?.room ? { room: opts.room } : {}),
      ...(opts?.replyToId ? { replyToId: opts.replyToId } : {}),
      timeoutMs: this.timeoutMs,
    });
  }

  /** GET /messages/search — substring search, newest first. `room` scopes the
   *  search to one room; omit to search across all rooms. */
  search(
    q: string,
    opts?: { room?: string; limit?: number },
  ): Promise<Message[]> {
    return searchMessagesFn(this.conn(), {
      q,
      ...(opts?.room ? { room: opts.room } : {}),
      ...(opts?.limit !== undefined ? { limit: opts.limit } : {}),
      ...this.callOpts(),
    });
  }

  /** POST /files — upload one image (multipart), returning its attachment
   *  descriptor. The id it returns is what you pass to `send` as an
   *  attachmentId. Pre-flight mime/size locally before calling.
   *
   *  NOTE: the Node convenience `uploadImage(path)` that reads + sniffs + calls
   *  this lives in `@club/sdk/node`, NOT on this class — this package's main
   *  entry is browser-safe (web imports `ClubClient`), so the fs/image-size
   *  helpers are isolated behind the Node-only subpath. */
  uploadFile(input: UploadFileInput): Promise<UploadFileResponse> {
    return uploadFile(this.conn(), input, { timeoutMs: this.timeoutMs });
  }

  /** GET /files/:id — fetch a file attachment by id. Returns raw bytes + metadata.
   *  Useful for agents to read files uploaded by others. Caller decodes by mime. */
  getFile(id: string): Promise<{ buffer: ArrayBuffer; mime: string; filename?: string }> {
    return getFile(this.conn(), id, { timeoutMs: this.timeoutMs });
  }

  /** GET /files/:id — fetch and parse a file attachment into readable text.
   *  Supports: text/*, JSON, PDF, Word (.docx), Excel (.xlsx). Returns a
   *  `ParsedFile` with parsed text and format info for agent consumption.
   *  NOTE: Only available in @club/sdk/node (Node.js environment). */
  async readFileContent(id: string): Promise<ParsedFile> {
    const { buffer, mime, filename } = await this.getFile(id);
    // Dynamic import of parser (only available in Node)
    const { parseFileContent } = await import("./file-parser.js");
    const parsed = await parseFileContent(buffer, mime, filename);
    return {
      text: parsed.text,
      format: parsed.format,
      mime,
      filename,
      metadata: parsed.metadata,
    };
  }

  /** POST /participants — mint a participant + single-use key (no auth needed). */
  createParticipant(
    input: CreateParticipantRequest,
  ): Promise<CreateParticipantResponse> {
    return createParticipantFn(this.conn(), input, { timeoutMs: this.timeoutMs });
  }

  /** POST /participants/recover — recover an identity by callsign + recovery
   *  code; reissues the key (and a fresh recovery code), reusing the id+name.
   *  No auth needed. */
  recoverParticipant(
    input: RecoverParticipantRequest,
  ): Promise<RecoverParticipantResponse> {
    return recoverParticipantFn(this.conn(), input, { timeoutMs: this.timeoutMs });
  }

  /** GET /messages/stream — live feed with auto-reconnect + catch-up. Pass
   *  `opts.room` / `opts.rooms` to subscribe to one or more rooms (the server
   *  then filters room-scoped events so a focused client doesn't pay for other
   *  rooms' traffic); omit to receive all rooms. Presence is always global. */
  stream(handler: (m: Message) => void, opts?: StreamOptions): StreamHandle {
    return streamMessages(this.conn(), handler, opts);
  }

  /** POST /agents/thinking — report that THIS agent has started processing a
   *  @mention (lights up the room's typing indicator). Agent-only; a human key
   *  gets 404. Idempotent in effect: re-reporting while already thinking just
   *  refreshes the TTL without re-broadcasting. `room` scopes the indicator to
   *  that room's stream; omit for the legacy unscoped (global) indicator. */
  reportAgentThinking(room?: string): Promise<void> {
    return reportAgentThinkingFn(this.conn(), {
      ...(room ? { room } : {}),
      timeoutMs: this.timeoutMs,
    });
  }

  /** POST /agents/idle — report that THIS agent finished (clears its typing
   *  indicator). Idempotent: a 204 no-op if it wasn't thinking. Pass the same
   *  `room` you reported thinking in so the clear reaches that room's stream. */
  reportAgentIdle(room?: string): Promise<void> {
    return reportAgentIdleFn(this.conn(), {
      ...(room ? { room } : {}),
      timeoutMs: this.timeoutMs,
    });
  }

  /** DELETE /messages/:id — soft-delete (recall) a message. Only the author
   *  may delete their own messages. Throws on 404 (not found or not yours). */
  deleteMessage(id: string): Promise<void> {
    return deleteMessageFn(this.conn(), id, { timeoutMs: this.timeoutMs });
  }

  /** POST /messages/:id/reactions { emoji } — toggle a reaction on a message.
   *  Adds the reaction if not present, removes if already present. Returns the
   *  updated aggregate [{ emoji, count }] so the caller can refresh the UI. */
  toggleReaction(id: string, emoji: string): Promise<Reaction[]> {
    return toggleMessageReactionFn(this.conn(), id, emoji, { timeoutMs: this.timeoutMs });
  }
}
