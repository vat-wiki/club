import type { Message, Participant } from "@club/shared";

// ── Errors ──────────────────────────────────────────────────────────
export class ClubApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// ── Config ──────────────────────────────────────────────────────────
export interface ClubConn {
  server: string; // base URL, e.g. http://localhost:3000
  key: string; // club_<kind>_<...> bearer token
}

function authHeaders(c: ClubConn): Record<string, string> {
  return { Authorization: `Bearer ${c.key}`, "content-type": "application/json" };
}

async function check(res: Response): Promise<any> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new ClubApiError(msg, res.status);
  }
  return res.status === 204 ? null : res.json();
}

// ── REST ────────────────────────────────────────────────────────────
export async function getMe(c: ClubConn): Promise<Participant> {
  return (await check(await fetch(`${c.server}/me`, { headers: authHeaders(c) })));
}

export async function listMessages(
  c: ClubConn,
  opts: { since?: string; limit?: number } = {},
): Promise<Message[]> {
  const params = new URLSearchParams();
  if (opts.since) params.set("since", opts.since);
  if (opts.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return (await check(
    await fetch(`${c.server}/messages${qs ? "?" + qs : ""}`, { headers: authHeaders(c) }),
  ));
}

export async function sendMessage(c: ClubConn, content: string): Promise<Message> {
  return (await check(
    await fetch(`${c.server}/messages`, {
      method: "POST",
      headers: authHeaders(c),
      body: JSON.stringify({ content }),
    }),
  ));
}

export async function listMembers(c: ClubConn): Promise<Participant[]> {
  return (await check(await fetch(`${c.server}/members`, { headers: authHeaders(c) })));
}

// ── SSE streaming ────────────────────────────────────────────────────
// Subscribe to /messages/stream. Returns a stop() handle; onMessage is
// invoked for each server event. The stream is read lazily and torn down
// when stop() is called (abort controller).
export function streamMessages(
  c: ClubConn,
  onMessage: (m: Message) => void,
): { stop: () => void } {
  const controller = new AbortController();
  void (async () => {
    try {
      const res = await fetch(`${c.server}/messages/stream`, {
        headers: { Authorization: `Bearer ${c.key}`, Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`stream failed: HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const raw = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const dataLines = raw
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart());
          if (dataLines.length === 0) continue; // heartbeat/empty
          const payload = dataLines.join("\n");
          if (payload === "") continue;
          try {
            onMessage(JSON.parse(payload) as Message);
          } catch {
            /* ignore malformed */
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        // surface non-abort errors via onMessage-less path; callers may log.
        console.error("[club] stream error:", (err as Error).message);
      }
    }
  })();
  return { stop: () => controller.abort() };
}

// ── Display formatting (shared by CLI & MCP text results) ───────────
export function formatMessage(m: Message): string {
  const t = new Date(m.createdAt);
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  const icon = m.authorKind === "agent" ? "🤖" : "🧑";
  return `[${hh}:${mm}] ${icon}${m.authorName}: ${m.content}`;
}