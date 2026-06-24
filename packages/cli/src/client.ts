import type { Message, Participant, ClubConn } from "@club/shared";
import { requireConfig, type ClubConfig } from "./config.js";

// Thin local re-exports so CLI command code stays unchanged: it imports
// named functions from "./client.js". We delegate to the shared client by
// adapting the local ClubConfig shape (server + key == ClubConn).
import {
  getMe as sharedGetMe,
  listMessages as sharedList,
  sendMessage as sharedSend,
  listMembers as sharedMembers,
  streamMessages as sharedStream,
  formatMessage as sharedFormat,
  ClubApiError,
} from "@club/shared";

export { ClubApiError as ApiError, sharedFormat as formatMessage };

function conn(cfg: ClubConfig): ClubConn {
  return { server: cfg.server, key: cfg.key };
}

export async function getMe(cfg: ClubConfig): Promise<Participant> {
  return sharedGetMe(conn(cfg));
}

export async function getMessages(
  cfg: ClubConfig,
  opts: { since?: string; limit?: number } = {},
): Promise<Message[]> {
  return sharedList(conn(cfg), opts);
}

export async function sendMessage(cfg: ClubConfig, content: string): Promise<Message> {
  return sharedSend(conn(cfg), content);
}

export async function getMembers(cfg: ClubConfig): Promise<Participant[]> {
  return sharedMembers(conn(cfg));
}

export function streamMessages(
  cfg: ClubConfig,
  onMessage: (m: Message) => void,
): { stop: () => void } {
  return sharedStream(conn(cfg), onMessage);
}