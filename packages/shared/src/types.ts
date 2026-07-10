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
  // Canonical room slug this message belongs to. Every message lives in exactly
  // one room; the default/system room is "general". Old clients/requests that
  // omit room land here, so the field is always present on server-sourced rows.
  room: string;
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
  // Aggregate emoji reactions on this message (emoji → count). Absent = none.
  reactions?: Reaction[];
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

// The MIME types club accepts as videos. Same single-source-of-truth pattern as
// ImageMime. Scope is deliberately the formats every modern browser decodes
// natively via <video> — mp4 (H.264/AAC, the dominant phone/camera recording
// format) and webm (VP8/VP9). Other containers (mov/avi/mkv…) are rejected
// rather than transcoded: native playback avoids any ffmpeg dependency (server
// or wasm) while covering virtually all real recordings. Unlike images, the
// server does NOT probe width/height for video — the <video> element reads them
// client-side via `onLoadedMetadata`, so no duration/dimension column is needed
// on `files` and the existing schema serves video unchanged.
export const VideoMime = z.enum(["video/mp4", "video/webm"]);
export type VideoMime = z.infer<typeof VideoMime>;

// The MIME types club accepts as document attachments. The browser can't render
// these inline natively (except PDF); preview is client-side — PDF via <iframe>,
// .docx/.xlsx via in-browser transcode libs (mammoth / sheetjs), markdown as a
// plain download. The server stores them verbatim and records only mime +
// filename + size (no probing).
export const DocumentMime = z.enum([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "text/markdown", // .md
]);
export type DocumentMime = z.infer<typeof DocumentMime>;

// Every MIME club will store and serve as an attachment (image, video, OR
// document). The upload route branches on this union; clients render based on
// which kind matches (<img> / <video> / file card).
export const AttachmentMime = z.enum([
  ...ImageMime.options,
  ...VideoMime.options,
  ...DocumentMime.options,
]);
export type AttachmentMime = z.infer<typeof AttachmentMime>;

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
  mime: ImageMime | VideoMime | DocumentMime; // clients branch on this
  width?: number; // px, lets the client reserve layout before the bytes load.
  // For images this is the server-probed dimension; for video it is typically
  // absent (the <video> element reads its own size via onLoadedMetadata).
  height?: number;
  size: number; // bytes
  // Original filename (e.g. "report.pdf"). Documents surface it on the file
  // card; images/videos typically omit it (they render from the id-derived url).
  filename?: string;
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
  // The room the mentioning message was posted in, so a cross-room @mention can
  // deep-link the recipient straight to that room + message. Always present.
  room: string;
}

// ── API request/response shapes ─────────────────────────────────────

export const CreateParticipantRequest = z.object({
  name: z.string().min(1).max(40),
  kind: ParticipantKind,
});
export type CreateParticipantRequest = z.infer<typeof CreateParticipantRequest>;

// ── Rooms (multi-room) ──────────────────────────────────────────────
//
// A room is an open topic channel — NOT an access-control boundary. Every
// authed participant reads/writes every room equally (PRD §4.1). Rooms are
// addressed by a stable canonical slug. `general` is the seeded system room;
// it always exists and is the default when a request omits room.

// Room slug: 1–30 chars of lowercase alphanumerics and hyphens, starting with
// an alphanumeric. Single source of truth shared by the server (POST /rooms,
// POST /messages room param) and any client doing pre-flight validation. The
// {0,29} after the leading char yields 1–30 total.
export const ROOM_SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,29}$/;
export const RoomSlug = z
  .string()
  .regex(
    ROOM_SLUG_REGEX,
    "room name must be 1-30 chars of [a-z0-9-], starting alphanumeric",
  );

// One room in the list returned by GET /rooms. `lastActivityAt` is the
// created_at of the most recent message in the room (null for an empty room)
// so clients can sort "unread-first, most-recently-active-first" without an
// extra round-trip. There is no server-side read state — unread is tracked
// client-side (PRD §5.2).
export interface Room {
  id: string;
  slug: string;
  createdAt: number;
  lastActivityAt: number | null;
}

// POST /rooms { name } — create/ensure a room exists. Idempotent: posting an
// existing slug returns that room without error. `name` is the canonical slug;
// there is no separate display name this phase (PRD §8.6).
export const CreateRoomRequest = z.object({
  name: RoomSlug,
});
export type CreateRoomRequest = z.infer<typeof CreateRoomRequest>;

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
// Per-message cap on attachments. Historically image-only ("MAX_IMAGES"), now a
// shared budget covering BOTH images and videos (a message may mix them) — kept
// under the original name so the SDK/CLI/web references don't churn. Videos are
// far heavier than images, so in practice a message rarely holds many, but the
// ceiling is uniform rather than tracking two separate counters.
export const MAX_IMAGES_PER_MESSAGE = 8;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024; // 25 MB

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
  // Room to post into; defaults to "general" for backward compatibility. Must
  // be a valid slug; posting to a non-existent (but valid) room auto-creates it
  // (PRD §9.4) — "build" and "enter" are the same action in the open model.
  room: RoomSlug.default("general"),
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
  // Room to scope to; omitted → "general" on the server (backward compatible).
  room?: string;
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
// `room`, when present, scopes the indicator to that room's stream; absent
// means an unscoped (legacy/global) report that reaches all subscribers.
export interface AgentThinkingEvent {
  participantId: string;
  name: string;
  kind: ParticipantKind;
  room?: string;
}

// SSE `event: agent_idle` payload. Just the id — the client removes it from its
// thinking set. Emitted on: reply posted (server-detected), agent-reported
// done/error, or server TTL expiry (crashed/offline agent). `room` mirrors the
// room the agent was thinking in so the clear event reaches the same stream.
export interface AgentIdleEvent {
  participantId: string;
  room?: string;
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
// than removing the row entirely (so replies/context still make sense). `room`
// lets the stream fan-out stay room-scoped (a client watching room B does not
// receive a recall from room A).
export interface MessageDeletedEvent {
  id: string;
  room: string;
}

// One emoji reaction aggregate on a message.
export interface Reaction {
  emoji: string;
  count: number;
}

// SSE `event: message_reaction` payload. A reaction was toggled; carries the
// refreshed aggregate so clients just swap it in. `room` keeps the fan-out
// room-scoped (a client watching room B does not receive a reaction from A).
export interface MessageReactionEvent {
  messageId: string;
  reactions: Reaction[];
  room: string;
}

// Body for POST /agents/thinking and POST /agents/idle — the agent reports its
// own status. Auth-required (the participant reports itself; the key identifies
// who). Only the optional `room` is accepted: when present the thinking/idle
// event is scoped to that room's stream; absent means unscoped (legacy/global).
// The participant is taken from the authed key, so a client can't forge another
// agent's status.
export const AgentStatusRequest = z
  .object({
    room: RoomSlug.optional(),
  })
  .strict();
export type AgentStatusRequest = z.infer<typeof AgentStatusRequest>;