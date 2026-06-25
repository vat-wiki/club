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

export const CreateMessageRequest = z.object({
  content: z.string().min(1).max(4000),
});
export type CreateMessageRequest = z.infer<typeof CreateMessageRequest>;

export interface ListMessagesQuery {
  since?: string; // message id — return messages after this one
  limit?: number;
}

export interface ApiError {
  error: string;
}