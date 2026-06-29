import { ClubClient, type ClubConn, request } from "@club/sdk";
import type {
  Participant,
  Message,
  CreateParticipantResponse,
  RecoverParticipantRequest,
  RecoverParticipantResponse,
} from "@club/shared";

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
  send: (c: ClubConn, content: string): Promise<Message> => client(c).send(content),
  members: (c: ClubConn): Promise<Participant[]> => client(c).members(),
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
