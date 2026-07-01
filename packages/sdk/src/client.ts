import type {
  CreateParticipantRequest,
  CreateParticipantResponse,
  ListMessagesQuery,
  Mention,
  Message,
  Participant,
  RecoverParticipantRequest,
  RecoverParticipantResponse,
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
  reportAgentThinking as reportAgentThinkingFn,
  reportAgentIdle as reportAgentIdleFn,
  sendMessage,
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

  /** POST /messages — send a message as the authenticated participant. */
  send(content: string): Promise<Message> {
    return sendMessage(this.conn(), content, { timeoutMs: this.timeoutMs });
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

  /** POST /agents/thinking — report that THIS agent has started processing a
   *  @mention (lights up the room's typing indicator). Agent-only; a human key
   *  gets 404. Idempotent in effect: re-reporting while already thinking just
   *  refreshes the TTL without re-broadcasting. */
  reportAgentThinking(): Promise<void> {
    return reportAgentThinkingFn(this.conn(), { timeoutMs: this.timeoutMs });
  }

  /** POST /agents/idle — report that THIS agent finished (clears its typing
   *  indicator). Idempotent: a 204 no-op if it wasn't thinking. */
  reportAgentIdle(): Promise<void> {
    return reportAgentIdleFn(this.conn(), { timeoutMs: this.timeoutMs });
  }
}
