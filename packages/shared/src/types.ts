import { z } from "zod";

// ── Domain ──────────────────────────────────────────────────────────

export const ParticipantKind = z.enum(["human", "agent"]);
export type ParticipantKind = z.infer<typeof ParticipantKind>;

export interface Participant {
  id: string;
  name: string;
  kind: ParticipantKind;
  createdAt: number;
}

export interface Message {
  id: string;
  participantId: string;
  authorName: string;
  authorKind: ParticipantKind;
  content: string;
  createdAt: number;
  // Images attached to the message; absent/empty = a plain text message
  // (backward compatible — old clients/rows simply have none). MVP scope: an
  // image is a *shareable/displayable* carrier, symmetric for humans and agents
  // (same history); it is NOT yet an agent multimodal input. The structured
  // shape is forward-compatible so "letting an agent see it" can arrive later
  // without a contract change.
  attachments?: MessageAttachment[];
  // Optional id of the message this one replies to (threaded quote). The
  // server stores it; clients render a quote by looking up the referenced
  // message in their local list.
  replyToId?: string;
  // True if the author recalled the message. The row stays for context but the
  // content is hidden; broadcast as a `message_deleted` event so every client
  // marks it recalled.
  deleted?: boolean;
  // Client-only delivery status for the optimistic send UI. Absent on every
  // server-sourced message (history + SSE) — those are already confirmed.
  // "sending" = locally echoed, waiting for POST /messages to resolve and
  // replace this row with the confirmed copy; "failed" = the POST threw, the
  // row is tinted red, and the composer keeps the draft so the user can retry.
  status?: "sending" | "failed";
}

// The MIME types club accepts as images. Single source of truth shared by the
// upload route (authoritative), the web client (pre-flight local reject), and
// the SDK/CLI.
export const ImageMime = z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export type ImageMime = z.infer<typeof ImageMime>;

// One image attached to a message. `id` is a server-generated unguessable random
// slug that doubles as the public `/files/{id}` path (serving is intentionally
// unauthenticated — `<img src>` cannot carry the bearer header, and club is a
// single room whose history every member sees anyway). `url` is root-relative so
// each client resolves it against its own server origin. The server is the sole
// source of truth for mime/width/height/size; clients only echo `id`s back when
// sending, so dimensions can't be forged.
export interface MessageAttachment {
  id: string;
  url: string; // root-relative, e.g. "/files/{id}"
  mime: ImageMime;
  width?: number; // px, lets the client reserve layout before the image loads
  height?: number;
  size: number; // bytes
}

// A @-mention of one participant by another. Persisted server-side so an agent
// (or human) that is offline when the mention happens can catch up later —
// this is the "inbox" that makes agents first-class without requiring them to
// be permanently online. `readAt` is null until the recipient marks it read.
export interface Mention {
  id: string;
  messageId: string;
  // Who was @-mentioned (the recipient / inbox owner).
  participantId: string;
  // Who sent the mentioning message (denormalized for display without a join).
  authorId: string;
  authorName: string;
  authorKind: ParticipantKind;
  content: string;
  messageCreatedAt: number;
  readAt: number | null;
}

// ── API request/response shapes ─────────────────────────────────────

export const CreateParticipantRequest = z.object({
  name: z.string().min(1).max(40),
  kind: ParticipantKind,
});
export type CreateParticipantRequest = z.infer<typeof CreateParticipantRequest>;

// Returned exactly once by POST /participants; the plaintext key and recovery
// code are never persisted server-side (only their sha256 hashes are stored).
// The recovery code is a fallback credential: present it with the callsign at
// POST /participants/recover to reissue the key (and a fresh recovery code)
// after losing the original key.
export interface CreateParticipantResponse {
  key: string;
  recoverCode: string;
  participant: Participant;
}

// Recover an existing identity by callsign + one-time recovery code. On
// success the server reissues a fresh key AND a fresh recovery code (the old
// recovery code is single-use and rotated), reusing the original id + name.
// On failure a uniform 401 is returned regardless of whether the name exists
// or the code is wrong, to prevent callsign enumeration.
export const RecoverParticipantRequest = z.object({
  name: z.string().min(1).max(40),
  recoverCode: z.string().min(1),
});
export type RecoverParticipantRequest = z.infer<typeof RecoverParticipantRequest>;

export interface RecoverParticipantResponse {
  key: string;
  recoverCode: string;
  participant: Participant;
}

// Image-input limits — shared so the web client's pre-flight checks and the
// upload route's authoritative checks can never drift apart.
export const MAX_MESSAGE_CONTENT = 4000;
export const MAX_IMAGES_PER_MESSAGE = 8;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

// content is optional IFF at least one attachment is supplied ("text-optional"
// keeps the common screenshot-then-send path frictionless — a bare image is a
// legitimate intent). The cross-field "content.trim() OR attachmentIds.length"
// rule is enforced in the route, not the schema, because zod can't express it
// cleanly. attachmentIds reference previously-uploaded files (POST /files); the
// server rehydrates their full metadata so clients can't forge dimensions.
export const CreateMessageRequest = z.object({
  content: z.string().max(MAX_MESSAGE_CONTENT).default(""),
  attachmentIds: z.array(z.string().min(1).max(64)).max(MAX_IMAGES_PER_MESSAGE).default([]),
  replyToId: z.string().min(1).max(64).optional(),
});
export type CreateMessageRequest = z.infer<typeof CreateMessageRequest>;

// POST /files (multipart, field "file") returns a single attachment descriptor;
// the client then references its `id` in a later POST /messages. Structurally a
// MessageAttachment — declared separately only to name the response shape.
export type UploadFileResponse = MessageAttachment;

export interface ListMessagesQuery {
  since?: string; // message id — return messages after this one
  before?: string; // message id — return messages BEFORE this one (older history; scroll-up pagination)
  limit?: number;
}

export interface ApiError {
  error: string;
}

// ── Agent "thinking" presence (P1-5) ────────────────────────────────
//
// club's agents are EXTERNAL processes (the `club listen` CLI loop, an MCP
// dispatcher, etc.) — the server hosts no agent execution loop. So an agent's
// "I'm processing this @mention" state is, like a human's typing, something the
// participant reports and the server merely relays. The server does add two
// safety nets the untrusted client can't provide alone: it auto-clears the
// state when the agent's reply lands (POST /messages by that participant), and
// it expires a stale thinking entry on a TTL so a crashed/offline agent can't
// leave the indicator stuck on.
//
// These ship over the SAME SSE stream as `message` events, but as named events
// (`event: agent_thinking` / `event: agent_idle`) so clients can branch on the
// event name rather than sniffing payloads. A client that only knows about
// `message` events ignores these (forward-compatible).

// SSE `event: agent_thinking` payload. `participantId`+`name`+`kind` are all
// carried so a client can render the indicator without a roster join (matches
// how `message` events denormalize authorName/authorKind). kind is the
// reporter's kind: agents report while processing a @mention, humans while
// typing — a client can label them differently or uniformly as "typing".
export interface AgentThinkingEvent {
  participantId: string;
  name: string;
  kind: ParticipantKind;
}

// SSE `event: agent_idle` payload. Just the id — the client removes it from its
// thinking set. Emitted on: reply posted (server-detected), agent-reported
// done/error, or server TTL expiry (crashed/offline agent).
export interface AgentIdleEvent {
  participantId: string;
}

// SSE `event: presence` payload. Broadcast on connect (online: true) and
// disconnect (online: false) so the roster can tell who's actually in the room
// right now from historical registrations. A newcomer is also seeded with the
// current online set on connect (server-side, see stream.ts).
export interface PresenceEvent {
  participantId: string;
  name: string;
  kind: ParticipantKind;
  online: boolean;
}

// SSE `event: message_deleted` payload. The author recalled a message; clients
// mark that id recalled (hide content, show a "recalled" placeholder) rather
// than removing the row entirely (so replies/context still make sense).
export interface MessageDeletedEvent {
  id: string;
}

// Body for POST /agents/thinking and POST /agents/idle — the agent reports its
// own status. Auth-required (the participant reports itself; the key identifies
// who). No fields in the body: the participant is taken from the authed key, so
// a client can't forge another agent's status.
export const AgentStatusRequest = z.object({}).strict();
export type AgentStatusRequest = z.infer<typeof AgentStatusRequest>;