import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { ulid } from "ulid";
import {
  CreateMessageRequest,
  type Message,
  type ParticipantKind,
} from "@club/shared";
import {
  getRecentMessages,
  getMessagesSince,
  insertMessage,
  type MessageRow,
} from "../db.js";
import { requireAuth } from "../auth.js";
import { addSubscriber, broadcast } from "../stream.js";

export const messages = new Hono();

messages.use("*", requireAuth);

function toMessage(r: MessageRow): Message {
  return {
    id: r.id,
    participantId: r.participant_id,
    authorName: r.author_name,
    authorKind: r.author_kind as ParticipantKind,
    content: r.content,
    createdAt: r.created_at,
  };
}

// POST /messages { content } -> Message
messages.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreateMessageRequest.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, 400);
  }
  const me = c.get("participant");
  const id = ulid();
  const createdAt = Date.now();
  insertMessage(id, me.id, parsed.data.content, createdAt);
  const msg: Message = {
    id,
    participantId: me.id,
    authorName: me.name,
    authorKind: me.kind,
    content: parsed.data.content,
    createdAt,
  };
  broadcast(msg);
  return c.json(msg, 201);
});

// GET /messages?since=<id>&limit=<n> -> Message[]  (chronologic)
messages.get("/", (c) => {
  const since = c.req.query("since");
  const limit = Math.min(Number(c.req.query("limit") ?? 100) || 100, 500);
  const rows = since ? getMessagesSince(since, limit).messages : getRecentMessages(limit);
  return c.json(rows.map(toMessage));
});

// GET /messages/stream  (SSE) — live message feed
messages.get("/stream", (c) => {
  return streamSSE(c, async (stream) => {
    const unsubscribe = addSubscriber(stream);
    stream.onAbort(() => {
      unsubscribe();
    });
    // Keep the stream open until the client disconnects.
    let alive = true;
    stream.onAbort(() => {
      alive = false;
    });
    while (alive) {
      await new Promise((r) => setTimeout(r, 30000));
      // hono/streaming keeps the connection; this loop just holds it open in
      // addition to broadcast()'d writes. A short sleeper bounds wakeups.
    }
    unsubscribe();
  });
});