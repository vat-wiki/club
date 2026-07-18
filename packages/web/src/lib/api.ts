import { ClubClient, request, type ClubConn } from "@club/sdk";
import type {
  CreateMessageRequest,
  Participant,
  Message,
  Room,
  UploadFileResponse,
  CreateParticipantResponse,
  RecoverParticipantRequest,
  RecoverParticipantResponse,
} from "@club/shared";
import { uploadImage } from "@/lib/upload";

// Thin facade over ClubClient so components import from one place. The real
// HTTP/SSE logic lives in @club/sdk's ClubClient; this just constructs a client
// per call from the connection the app holds.
function client(c: ClubConn): ClubClient {
  return new ClubClient(c);
}

export const api = {
  me: (c: ClubConn): Promise<Participant> => client(c).me(),
  // `room` scopes history to a room (default "general" server-side when omitted).
  // `since` returns messages after an id; omitted here returns the recent batch.
  messages: (c: ClubConn, since?: string, room?: string): Promise<Message[]> =>
    client(c).messages({ since, room, limit: 50 }),
  // content is optional IFF attachmentIds is non-empty (the server enforces the
  // cross-field rule; see CreateMessageRequest in @club/shared). When there are
  // no attachments we keep the original content-only body shape (unchanged path).
  // `room` posts into a specific room (default "general"); posting into a valid
  // but non-existent room auto-creates it (PRD §9.4 — build = enter).
  send: (
    c: ClubConn,
    content: string,
    attachmentIds: readonly string[] = [],
    replyToId?: string,
    room?: string,
  ): Promise<Message> => {
    if (attachmentIds.length > 0 || replyToId || room) {
      const body: CreateMessageRequest = {
        content,
        attachmentIds: [...attachmentIds],
        room: room ?? "general",
        ...(replyToId ? { replyToId } : {}),
      };
      return request<Message>(c, "/messages", { method: "POST", body });
    }
    return client(c).send(content);
  },
  members: (c: ClubConn): Promise<Participant[]> => client(c).members(),
  // GET /rooms — every room, general first then most-recently-active first.
  rooms: (c: ClubConn): Promise<Room[]> => client(c).rooms(),
  // POST /rooms { name } — create/ensure a room exists (idempotent).
  createRoom: (c: ClubConn, name: string): Promise<Room> => client(c).createRoom(name),
  // `room` scopes the search to one room; omit to search across all rooms.
  search: (c: ClubConn, q: string, room?: string): Promise<Message[]> =>
    client(c).search(q, room ? { room } : undefined),
  deleteMessage: (c: ClubConn, id: string): Promise<void> =>
    request<void>(c, `/messages/${encodeURIComponent(id)}`, { method: "DELETE" }),
  react: (c: ClubConn, messageId: string, emoji: string): Promise<void> =>
    request<void>(c, `/messages/${encodeURIComponent(messageId)}/reactions`, {
      method: "POST",
      body: { emoji },
    }),
  // Report "I'm typing" / "I stopped" — drives the typing indicator for both
  // humans (debounced while composing) and agents (while processing a mention).
  // `room` scopes the indicator to that room's stream (PRD §5.1).
  thinking: (c: ClubConn, room?: string): Promise<void> =>
    client(c).reportAgentThinking(room),
  idle: (c: ClubConn, room?: string): Promise<void> => client(c).reportAgentIdle(room),
  // multipart image upload — see lib/upload for why this bypasses the JSON
  // transport. The returned attachment's `id` is later echoed in send().
  uploadFile: (
    c: ClubConn,
    file: File,
    opts?: { timeoutMs?: number; onProgress?: (loaded: number, total: number) => void },
  ): Promise<UploadFileResponse> => uploadImage(c, file, opts),
};

export async function createParticipant(
  server: string,
  name: string,
): Promise<{ key: string; recoverCode: string }> {
  const { key, recoverCode } = await new ClubClient({ server }).createParticipant({
    name,
  });
  return { key, recoverCode };
}

// Recover an existing identity by callsign + one-time recovery code. Calls
// POST /participants/recover directly via the SDK's `request` helper instead of
// ClubClient.recover — the SDK client method is being added in parallel by the
// backend owner; going through `request` keeps us out of packages/sdk/src while
// still using the shared contract types.
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
