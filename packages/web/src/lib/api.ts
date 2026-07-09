import { ClubClient, request, type ClubConn } from "@club/sdk";
import type {
  Participant,
  Message,
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
  messages: (c: ClubConn, since?: string): Promise<Message[]> =>
    client(c).messages({ since, limit: 50 }),
  // content is optional IFF attachmentIds is non-empty (the server enforces the
  // cross-field rule; see CreateMessageRequest in @club/shared). When there are
  // no attachments we keep the original content-only body shape (unchanged path).
  send: (
    c: ClubConn,
    content: string,
    attachmentIds: readonly string[] = [],
    replyToId?: string,
  ): Promise<Message> => {
    if (attachmentIds.length > 0 || replyToId) {
      const body: Record<string, unknown> = { content, attachmentIds: [...attachmentIds] };
      if (replyToId) body.replyToId = replyToId;
      return request<Message>(c, "/messages", { method: "POST", body });
    }
    return client(c).send(content);
  },
  members: (c: ClubConn): Promise<Participant[]> => client(c).members(),
  // Report "I'm typing" / "I stopped" — drives the typing indicator for both
  // humans (debounced while composing) and agents (while processing a mention).
  thinking: (c: ClubConn): Promise<void> => client(c).reportAgentThinking(),
  idle: (c: ClubConn): Promise<void> => client(c).reportAgentIdle(),
  // multipart image upload — see lib/upload for why this bypasses the JSON
  // transport. The returned attachment's `id` is later echoed in send().
  uploadFile: (
    c: ClubConn,
    file: File,
    opts?: { onProgress?: (loaded: number, total: number) => void },
  ): Promise<UploadFileResponse> => uploadImage(c, file, opts),
};

export async function createParticipant(
  server: string,
  name: string,
  kind: "human" | "agent",
): Promise<{ key: string; recoverCode: string }> {
  const { key, recoverCode } = await new ClubClient({ server }).createParticipant({
    name,
    kind,
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
