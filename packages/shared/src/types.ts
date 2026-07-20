import { z } from "zod";

// ── Domain ──────────────────────────────────────────────────────────

// A participant is a participant — club deliberately does NOT classify people
// into "human" vs "agent". Whether someone is an agent is something they convey
// themselves (name, self-introduction, behavior), never a system-assigned label.
// See .pd-docs/requirements/category-blind.md.

/**
 * A registered participant in the club.
 *
 * Id is a server-generated unique string; createdAt is the Unix-timestamp (ms)
 * when the participant was registered. Id and name together let a participant be
 * looked up without an extra round-trip (denormalized across messages, mentions,
 * and SSE events).
 */
export interface Participant {
  id: string;
  name: string;
  createdAt: number;
}

/**
 * A single chat message with optional attachments.
 *
 * Messages are created via POST /messages and broadcast via SSE.
 * The `status` field is client-only for optimistic UI; server-sourced
 * messages never have it set.
 */
export interface Message {
  id: string;
  participantId: string;
  authorName: string;
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
/** Accepted image MIME types */
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
/** Accepted video MIME types (mp4, webm - formats browsers decode natively) */
export const VideoMime = z.enum(["video/mp4", "video/webm"]);
export type VideoMime = z.infer<typeof VideoMime>;

// The MIME types club accepts as document attachments. The browser can't render
// these inline natively (except PDF); preview is client-side — PDF via <iframe>,
// .docx/.xlsx via in-browser transcode libs (mammoth / sheetjs), markdown as a
// plain download. The server stores them verbatim and records only mime +
// filename + size (no probing).
/** Accepted document MIME types (pdf, docx, xlsx, markdown) */
export const DocumentMime = z.enum([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "text/markdown", // .md
]);
export type DocumentMime = z.infer<typeof DocumentMime>;

/** Union of all accepted attachment MIME types */
export const AttachmentMime = z.enum([
  ...ImageMime.options,
  ...VideoMime.options,
  ...DocumentMime.options,
]);
export type AttachmentMime = z.infer<typeof AttachmentMime>;

/**
 * One attachment (image, video, or document) on a message.
 *
 * The `id` is a server-generated unguessable random slug that doubles as the
 * public `/files/{id}` path. Serving is intentionally unauthenticated — `<img src>`
 * cannot carry the bearer header, and club is a single room whose history every
 * member sees anyway. The server is the sole source of truth for dimensions;
 * clients only echo `id`s back, so they can't be forged.
 */
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

/**
 * A @-mention of one participant by another.
 *
 * Persisted server-side so an agent (or human) that is offline when the mention
 * happens can catch up later — this is the "inbox" that makes agents first-class
 * without requiring them to be permanently online. `readAt` is null until the
 * recipient marks it read.
 */
export interface Mention {
  id: string;
  messageId: string;
  // Who was @-mentioned (the recipient / inbox owner).
  participantId: string;
  // Who sent the mentioning message (denormalized for display without a join).
  authorId: string;
  authorName: string;
  content: string;
  messageCreatedAt: number;
  readAt: number | null;
  // The room the mentioning message was posted in, so a cross-room @mention can
  // deep-link the recipient straight to that room + message. Always present.
  room: string;
}

// ── API request/response shapes ─────────────────────────────────────

// NOTE: no `kind` — club does not classify participants (category-blind). The
// schema is non-strict, so a legacy client still sending `{ name, kind }` is
// silently stripped of `kind` rather than rejected (graceful deprecation).
//
// Participant names must pass a whitelist so an attacker cannot register a name
// containing CRLF / control / invisible-Unicode sequences that would otherwise
// break SSE framing, log parsing, and terminal rendering. Alphanumerics,
// common marks (CJK ideographs, accents, etc.), spaces, hyphens, underscores,
// dots and apostrophes are allowed. ASCII control chars, newlines and the
// entire invisible-Unicode range are rejected.
//
// Unicode categories:
//   L  — letters  (Latin, CJK ideographs, Cyrillic, Hangul, …)
//   N  — numbers  (Arabic, Indic, Kana, etc.)
//   M  — marks    (accents, combining marks, variation selectors)
//   "  — literal space
//   -  _ . '     — safe structural punctuation
//   /\u00A0/    — non-breaking space (commonly used in names)
//
// NOTE: we do NOT use /\s/ because it matches newlines and other whitespace
// that we want to reject. Space is included explicitly via the literal ' ' in
// the class; non-breaking space via the literal \u00A0.
// Rejected: /\x00-\x1F\x7F/ (control + DEL), /\u200B-\u200F\u2028\u2029
//   \u2060-\u206F/ (ZWSP, directional, BOM-like), /\uFEFF/ (BOM),
//   leading/trailing whitespace, whitespace-only names.
//
// Security rationale: prior regex allowed "   " and " Alice " which enable
// callsign confusion ("Alice" vs "Alice ") and DB bloat. The regex now
// requires the first and last character to be non-whitespace (`[\p{L}\p{N}\p{M}\-_.']`)
// while allowing spaces inside (e.g. "Maria José") so multi-word names survive.
export const ParticipantNameRegex = /^[\p{L}\p{N}\p{M}\-_.'][\p{L}\p{N}\p{M} \u00A0\-_.']{0,38}[\p{L}\p{N}\p{M}\-_.']$/u;

// A single-character name (e.g. "A", "_", "·") must still be allowed.
// `ParticipantNameRegex` with its mandatory trailing non-space group enforces
// length ≥ 2 for names with internal whitespace; use a permissive single-char
// fallback for the 1-char case so names like "A" and "Z" aren't rejected.
const SingleCharParticipantNameRegex = /^[\p{L}\p{N}\p{M}\-_.']$/u;

export const ParticipantName = z
  .string()
  .refine(
    (v) =>
      ParticipantNameRegex.test(v) || SingleCharParticipantNameRegex.test(v),
    "participant name may only contain letters, numbers, spaces, hyphens, underscores, dots and apostrophes, and must not start or end with whitespace",
  );

/** Request body for POST /participants — create a new participant */
export const CreateParticipantRequest = z.object({
  name: ParticipantName,
});
export type CreateParticipantRequest = z.infer<typeof CreateParticipantRequest>;

// ── Rooms (multi-room) ──────────────────────────────────────────────
//
// A room is an open topic channel — NOT an access-control boundary. Every
// authed participant reads/writes every room equally (PRD §4.1). Rooms are
// addressed by a stable canonical slug. `general` is the seeded system room;
// it always exists and is the default when a request omits room.

/** Room slug regex: 1–30 chars of lowercase alphanumerics and hyphens, starting with alphanumeric */
export const ROOM_SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,29}$/;
export const RoomSlug = z
  .string()
  .regex(
    ROOM_SLUG_REGEX,
    "room name must be 1-30 chars of [a-z0-9-], starting alphanumeric",
  );

/** Room slug type — used by SDK/CLI callers who need the schema value as a TS type. */
export type RoomSlugType = z.infer<typeof RoomSlug>;

/**
 * One room in the list returned by GET /rooms.
 *
 * `lastActivityAt` is the created_at of the most recent message in the room
 * (null for an empty room) so clients can sort "unread-first,
 * most-recently-active-first" without an extra round-trip. There is no
 * server-side read state — unread is tracked client-side (PRD §5.2).
 */
export interface Room {
  id: string;
  slug: string;
  createdAt: number;
  lastActivityAt: number | null;
}

// POST /rooms { name } — create/ensure a room exists. Idempotent: posting an
// existing slug returns that room without error. `name` is the canonical slug;
// there is no separate display name this phase (PRD §8.6).
/** Request body for POST /rooms — create or ensure a room exists (idempotent) */
export const CreateRoomRequest = z.object({
  name: RoomSlug,
});
export type CreateRoomRequest = z.infer<typeof CreateRoomRequest>;

/**
 * Response from POST /participants.
 *
 * The plaintext key and recovery code are never persisted server-side
 * (only their sha256 hashes are stored). The recovery code is a fallback
 * credential: present it with the callsign at POST /participants/recover
 * to reissue the key (and a fresh recovery code) after losing the original key.
 */
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
/** Request body for POST /participants/recover — recover identity by callsign + recovery code */
export const RecoverParticipantRequest = z.object({
  name: ParticipantName,
  recoverCode: z.string().min(1),
});
export type RecoverParticipantRequest = z.infer<typeof RecoverParticipantRequest>;

/** Response from POST /participants/recover */
export interface RecoverParticipantResponse {
  key: string;
  recoverCode: string;
  participant: Participant;
}

// ── Domain constants ─────────────────────────────────────────────────
// Shared across CLI, SDK, and server so the default/system room slug never
// drifts between packages. Kept in `types.ts` so it lives next to the room-
// related type definitions.

/** Canonical slug of the system/default room. Seeded by the migration; the
 *   value every client, route, and command falls back to when no room is
 *   chosen.
 * @see https://club-docs/rooms/#general
 */
export const DEFAULT_ROOM = "general";

// ── Content limits ─────────────────────────────────────────────────────
// Shared constants so client pre-flight checks and server validation never drift.

/** Maximum message content length in characters */
export const MAX_MESSAGE_CONTENT = 4000;
// Per-message cap on attachments. Historically image-only ("MAX_IMAGES"), now a
// shared budget covering BOTH images and videos (a message may mix them) — kept
// under the original name so the SDK/CLI/web references don't churn. Videos are
// far heavier than images, so in practice a message rarely holds many, but the
// ceiling is uniform rather than tracking two separate counters.
/** Maximum number of attachments per message (images + videos combined) */
export const MAX_IMAGES_PER_MESSAGE = 10;
/** Maximum file size for image uploads in bytes (10 MB) */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Maximum file size for video uploads in bytes (50 MB) */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
/** Maximum file size for document uploads in bytes (25 MB) */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

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
  // Room to post into; defaults to the shared `DEFAULT_ROOM` slug for
  // backward compatibility. Must be a valid slug; posting to a non-existent
  // (but valid) room auto-creates it (PRD §9.4) — "build" and "enter" are
  // the same action in the open model.
  room: RoomSlug.default(DEFAULT_ROOM),
});
export type CreateMessageRequest = z.infer<typeof CreateMessageRequest>;

// POST /files (multipart, field "file") returns a single attachment descriptor;
// the client then references its `id` in a later POST /messages. Structurally a
// MessageAttachment — declared separately only to name the response shape.
/** Response from POST /files — a newly uploaded attachment */
export type UploadFileResponse = MessageAttachment;

/** Query parameters for GET /messages — list messages with optional pagination */
export interface ListMessagesQuery {
  since?: string; // message id — return messages after this one
  before?: string; // message id — return messages BEFORE this one (older history; scroll-up pagination)
  limit?: number;
  // Room to scope to; omitted → "general" on the server (backward compatible).
  room?: string;
}

/** Generic error response shape returned by the API on any failure */
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

// SSE `event: agent_thinking` payload. `participantId`+`name` are carried so a
// client can render the indicator without a roster join (matches how `message`
// events denormalize authorName). The event name retains an "agent" legacy but
// the mechanism is kind-agnostic: any participant (an agent processing a
// @mention OR a human typing) reports and is shown as "typing". `room`, when
// present, scopes the indicator to that room's stream; absent means an unscoped
// (legacy/global) report that reaches all subscribers.
export interface AgentThinkingEvent {
  participantId: string;
  name: string;
  room?: string;
}

/**
 * SSE `event: agent_idle` payload.
 *
 * Just the id — the client removes it from its thinking set. Emitted on:
 * reply posted (server-detected), agent-reported done/error, or server TTL
 * expiry (crashed/offline agent). `room` mirrors the room the agent was
 * thinking in so the clear event reaches the same stream.
 */
export interface AgentIdleEvent {
  participantId: string;
  room?: string;
}

/**
 * SSE `event: presence` payload.
 *
 * Broadcast on connect (online: true) and disconnect (online: false) so the
 * roster can tell who's actually in the room right now from historical
 * registrations. A newcomer is also seeded with the current online set on
 * connect (server-side, see stream.ts).
 */
export interface PresenceEvent {
  participantId: string;
  name: string;
  online: boolean;
}

/**
 * SSE `event: message_deleted` payload.
 *
 * The author recalled a message; clients mark that id recalled (hide content,
 * show a "recalled" placeholder) rather than removing the row entirely
 * (so replies/context still make sense). `room` lets the stream fan-out stay
 * room-scoped (a client watching room B does not receive a recall from room A).
 */
export interface MessageDeletedEvent {
  id: string;
  room: string;
}

/** One emoji reaction aggregate on a message */
export interface Reaction {
  emoji: string;
  count: number;
}

/**
 * SSE `event: message_reaction` payload.
 *
 * A reaction was toggled; carries the refreshed aggregate so clients just swap
 * it in. `room` keeps the fan-out room-scoped (a client watching room B does not
 * receive a reaction from A).
 */
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
/** Request body for POST /agents/thinking and POST /agents/idle — report agent status */
export const AgentStatusRequest = z
  .object({
    room: RoomSlug.optional(),
  })
  .strict();
export type AgentStatusRequest = z.infer<typeof AgentStatusRequest>;

/**
 * Toggle a single emoji reaction on a message.
 * Accepted on POST /messages/:id/reactions.
 */
export const ToggleReactionRequest = z
  .object({
    emoji: z.string().max(32),
  })
  .strict();
export type ToggleReactionRequest = z.infer<typeof ToggleReactionRequest>;

/**
 * Batch-mark @-mentions as read.
 * Accepted on POST /me/mentions/read. Empty `ids` is a no-op (200, []).
 */
export const MarkMentionsReadRequest = z
  .object({
    ids: z.array(z.string().min(1).max(64)),
  })
  .strict();
export type MarkMentionsReadRequest = z.infer<typeof MarkMentionsReadRequest>;

// ── Shared limit parsing ────────────────────────────────────────────
//
// `parseLimit` is the single source of truth for clamping a request-side
// `limit` argument into the supported [1, 500] range. Every consumer that
// receives user input (server query-param, CLI flag, MCP tool arg) is now a
// thin wrapper around this one pure function so the bounds and fallback rules
// stay in sync across packages.

// Shared core: given a finite positive number, clamp it to [1, 500].
// Pure; called only by the helpers below after each validates finiteness.
/**
 * Clamp a finite positive number into the supported query range [1, 500].
 *
 * The value is floored before clamping so fractional requesters never
 * exceed the ceiling. Pure and deterministic.
 *
 * @param n - A finite positive number (must already be validated by caller).
 * @returns `n` floored and clamped to the inclusive range [1, 500].
 * @example
 * clampPositive(100); // 100
 * clampPositive(1000); // 500
 * clampPositive(0.5);  // 1
 */
export function clampPositive(n: number): number {
  return Math.min(Math.max(1, Math.floor(n)), 500);
}

/**
 * Parse a `limit` from an HTTP query parameter (string | number | undefined).
 *
 * Strict semantics: non-finite numbers, 0, and negatives all fall back to the
 * default rather than being clamped to 1, so a malformed query-param can never
 * result in an unbounded SQL LIMIT (negative LIMIT means "no limit" in SQLite).
 *
 * @param raw - The raw query parameter value (`?limit=…`).
 * @param fallback - Default when `raw` is invalid / absent. Defaults to 100.
 * @returns A value in [1, 500], or `fallback` when `raw` is missing, non-finite, or ≤ 0.
 * @example
 * parseQueryLimit("25")        // 25
 * parseQueryLimit("-5")        // fallback (100)
 * parseQueryLimit(undefined)   // fallback (100)
 * parseQueryLimit("1000")      // 500
 */
export function parseQueryLimit(
  raw: string | number | undefined,
  fallback = 100,
): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return clampPositive(n);
}

/**
 * Parse a `limit` from a CLI flag string. Used by the CLI `read` command.
 *
 * Tolerant: 0/negatives clamp to 1 (CLI is an interactive tool; a typo
 * should degrade gracefully to the smallest batch, not trigger a fallback
 * that surprises the user).
 *
 * @param raw - The raw CLI option string (e.g. `"100"`).
 * @param fallback - Default when `raw` is absent, blank, or non-finite. Defaults to 50.
 * @returns A value in [1, 500] (0 / negative inputs are floored to 1), or `fallback` when absent/blank/non-finite.
 * @example
 * parseFlagLimit("25")        // 25
 * parseFlagLimit("-5")        // 1 (graceful degrade)
 * parseFlagLimit(undefined)   // 50
 * parseFlagLimit("0")         // 1
 */
export function parseFlagLimit(raw: string | undefined, fallback = 50): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return clampPositive(n);
}

/**
 * Parse a `limit` from an MCP tool argument (any shape). Used by the MCP
 * dispatcher.
 *
 * Tolerant of 0/negatives (same rationale as CLI) — an LLM that sends a bad
 * limit should get a small result, not an error. Non-number, non-string
 * values fall back directly.
 *
 * @param raw - The MCP tool argument value (any JSON type).
 * @param fallback - Default when `raw` is an unsupported shape or non-finite. Defaults to 50.
 * @returns A value in [1, 500], or `fallback` when `raw` can't be parsed as a finite number.
 * @example
 * parseToolLimit(25)        // 25
 * parseToolLimit("-5")      // 1
 * parseToolLimit(null)      // fallback (50)
 * parseToolLimit("abc")     // fallback (50)
 */
export function parseToolLimit(raw: unknown, fallback = 50): number {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return fallback;
    return clampPositive(raw);
  }
  if (typeof raw === "string") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return clampPositive(n);
  }
  return fallback;
}
