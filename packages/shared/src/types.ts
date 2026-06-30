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

// Returned exactly once by POST /participants; the plaintext key is never
// persisted server-side.
export interface CreateParticipantResponse {
  key: string;
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
});
export type CreateMessageRequest = z.infer<typeof CreateMessageRequest>;

// POST /files (multipart, field "file") returns a single attachment descriptor;
// the client then references its `id` in a later POST /messages. Structurally a
// MessageAttachment — declared separately only to name the response shape.
export type UploadFileResponse = MessageAttachment;

export interface ListMessagesQuery {
  since?: string; // message id — return messages after this one
  limit?: number;
}

export interface ApiError {
  error: string;
}