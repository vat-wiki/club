import { ClubClient, request, type ClubConn } from "@club/sdk";
import type { Participant, Message, UploadFileResponse } from "@club/shared";
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
  send: (c: ClubConn, content: string, attachmentIds: readonly string[] = []): Promise<Message> =>
    attachmentIds.length > 0
      ? request<Message>(c, "/messages", {
          method: "POST",
          body: { content, attachmentIds: [...attachmentIds] },
        })
      : client(c).send(content),
  members: (c: ClubConn): Promise<Participant[]> => client(c).members(),
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
): Promise<{ key: string }> {
  const { key } = await new ClubClient({ server }).createParticipant({ name, kind });
  return { key };
}
