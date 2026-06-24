import {
  getMe,
  listMessages,
  sendMessage,
  listMembers,
  type ClubConn,
} from "@club/sdk";
import type { Participant, Message } from "@club/shared";

// Thin re-export so components import from one place. The real HTTP/SSE logic
// lives in @club/shared and is shared verbatim with the CLI and MCP clients.
export const api = {
  me: (c: ClubConn): Promise<Participant> => getMe(c),
  messages: (c: ClubConn, since?: string): Promise<Message[]> => listMessages(c, { since, limit: 50 }),
  send: (c: ClubConn, content: string): Promise<Message> => sendMessage(c, content),
  members: (c: ClubConn): Promise<Participant[]> => listMembers(c),
};

export async function createParticipant(
  server: string,
  name: string,
  kind: "human" | "agent",
): Promise<{ key: string }> {
  const res = await fetch(`${server}/participants`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, kind }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as { key: string };
}