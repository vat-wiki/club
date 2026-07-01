import type {
  CreateParticipantRequest,
  CreateParticipantResponse,
  ListMessagesQuery,
  Mention,
  Message,
  Participant,
  RecoverParticipantRequest,
  RecoverParticipantResponse,
  UploadFileResponse,
} from "@club/shared";
import {
  type CallOpts,
  type ClubConn,
  createParticipant as createParticipantFn,
  getMe,
  listMembers,
  listMentions,
  listMessages,
  markMentionRead,
  recoverParticipant as recoverParticipantFn,
  sendMessage,
  uploadFile,
  type UploadFileInput,
} from "./transport.js";
import { streamMessages, type StreamHandle, type StreamOptions } from "./stream.js";

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

  /** GET /me/mentions — the caller's UNREAD @-mentions, oldest first. */
  mentions(): Promise<Mention[]> {
    return listMentions(this.conn(), this.callOpts());
  }

  /** POST /me/mentions/:id/read — mark one mention as read. */
  markMentionRead(id: string): Promise<Mention> {
    return markMentionRead(this.conn(), id, { timeoutMs: this.timeoutMs });
  }

  /** GET /messages — recent history, optionally after `since` (message id). */
  messages(opts: ListMessagesQuery = {}): Promise<Message[]> {
    return listMessages(this.conn(), { ...opts, ...this.callOpts() });
  }

  /** POST /messages — send a message as the authenticated participant.
   *  `attachmentIds` references files previously uploaded via `uploadFile`;
   *  when omitted the body is the legacy `{ content }` shape. Pass an empty
   *  content with attachmentIds to send an image-only message. */
  send(content: string, attachmentIds?: string[]): Promise<Message> {
    return sendMessage(this.conn(), content, {
      ...(attachmentIds && attachmentIds.length > 0 ? { attachmentIds } : {}),
      timeoutMs: this.timeoutMs,
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

  /** GET /messages/stream — live feed with auto-reconnect + catch-up. */
  stream(handler: (m: Message) => void, opts?: StreamOptions): StreamHandle {
    return streamMessages(this.conn(), handler, opts);
  }
}
