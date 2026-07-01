import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { ulid } from "ulid";
import {
  CreateMessageRequest,
  type Message,
  type MessageAttachment,
  type ParticipantKind,
} from "@club/shared";
import {
  getRecentMessages,
  getMessagesSince,
  insertMessage,
  getFilesByIds,
  getAllParticipantNames,
  insertMention,
  type MessageRow,
} from "../db.js";
import { requireAuth } from "../auth.js";
import { addSubscriber, broadcast, isThinking, markThinkingIdle, broadcastAgentIdle } from "../stream.js";
import { parseLimit } from "../lib.js";
import { extractMentionedParticipants } from "../mention.js";

export const messages = new Hono();

messages.use("*", requireAuth);

// Parse the `attachments` JSON column into a MessageAttachment[], or omit it
// entirely for plain-text rows (keeps the shape backward compatible — old rows
// and rows with no images simply have no `attachments` key).
function parseAttachments(raw: string | null): MessageAttachment[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0
      ? (parsed as MessageAttachment[])
      : undefined;
  } catch {
    return undefined;
  }
}

function toMessage(r: MessageRow): Message {
  const msg: Message = {
    id: r.id,
    participantId: r.participant_id,
    authorName: r.author_name,
    authorKind: r.author_kind as ParticipantKind,
    content: r.content,
    createdAt: r.created_at,
  };
  const attachments = parseAttachments(r.attachments);
  if (attachments) msg.attachments = attachments;
  return msg;
}

// POST /messages { content?, attachmentIds? } -> Message
// content is optional iff at least one attachment is supplied (plan §1 — a bare
// screenshot is the most common intent, forcing text would add friction). The
// cross-field rule is enforced here, not in zod, because zod can't express it.
messages.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreateMessageRequest.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, 400);
  }
  const { content, attachmentIds } = parsed.data;

  // Rehydrate attachments server-side from the requested ids. The server is the
  // sole source of truth for mime/width/height/size, so the client only sends
  // ids — dimensions can't be forged. We also enforce that every requested id
  // exists AND belongs to the sender: a participant can only attach files it
  // uploaded, never another participant's.
  let attachments: MessageAttachment[] = [];
  if (attachmentIds.length > 0) {
    const rows = getFilesByIds(attachmentIds);
    // Reject if any id is missing or doesn't belong to this participant.
    if (rows.length !== attachmentIds.length) {
      return c.json({ error: "attachment not found" }, 400);
    }
    if (rows.some((r) => r.participant_id !== c.get("participant").id)) {
      return c.json({ error: "attachment not owned by sender" }, 403);
    }
    // Preserve the order the user chose (getFilesByIds already keeps input
    // order); build the attachment list from authoritative server metadata.
    attachments = rows.map((r) => ({
      id: r.id,
      url: `/files/${r.id}`,
      mime: r.mime as MessageAttachment["mime"],
      ...(r.width != null ? { width: r.width } : {}),
      ...(r.height != null ? { height: r.height } : {}),
      size: r.size,
    }));
  }

  // Cross-field rule: text OR image. Empty text with no images is rejected.
  if (!content.trim() && attachments.length === 0) {
    return c.json({ error: "content or attachment required" }, 400);
  }

  const me = c.get("participant");
  const id = ulid();
  const createdAt = Date.now();
  insertMessage(
    id,
    me.id,
    content,
    createdAt,
    attachments.length > 0 ? JSON.stringify(attachments) : null,
  );

  // Persist a per-participant inbox row for everyone @-mentioned in the text.
  // The recipient list is computed server-side (see mention.ts) so it is the
  // single source of truth — clients no longer have to each re-derive it, and
  // an offline recipient still finds the mention on next poll. We do NOT
  // exclude the author: the client-side `listen --mention` matcher doesn't
  // either, so the inbox must agree with what a live listen would have caught.
  const mentioned = extractMentionedParticipants(
    content,
    getAllParticipantNames(),
  );
  for (const m of mentioned) {
    insertMention(ulid(), id, m.id, me.id, createdAt);
  }

  const msg: Message = {
    id,
    participantId: me.id,
    authorName: me.name,
    authorKind: me.kind,
    content,
    createdAt,
  };
  if (attachments.length > 0) msg.attachments = attachments;
  broadcast(msg);

  // P1-5: an agent's reply landing is the most reliable "done thinking" signal
  // — clear its indicator right now, regardless of whether the agent client
  // also reports idle. This is the safety net for agents that crash right after
  // posting (so their own idle report never fires).
  if (me.kind === "agent" && isThinking(me.id)) {
    markThinkingIdle(me.id);
    broadcastAgentIdle({ participantId: me.id });
  }
  return c.json(msg, 201);
});

// GET /messages?since=<id>&limit=<n> -> Message[]  (chronologic)
messages.get("/", (c) => {
  const since = c.req.query("since");
  const limit = parseLimit(c.req.query("limit"));
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