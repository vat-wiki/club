import { ClubClient, type ClubConn } from "@club/sdk";
import type { Participant, Message } from "@club/shared";

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
): Promise<{ key: string }> {
  const { key } = await new ClubClient({ server }).createParticipant({ name, kind });
  return { key };
}
