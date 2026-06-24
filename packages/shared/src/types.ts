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