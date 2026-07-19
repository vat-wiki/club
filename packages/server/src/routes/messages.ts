import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { ulid } from "ulid";
import {
  CreateMessageRequest,
  type Message,
  type MessageAttachment,
  type Reaction,
  type MessageReactionEvent,
} from "@club/shared";
import {
  getRecentMessages,
  getMessagesSince,
  getMessagesBeforeId,
  searchMessages,
  deleteMessage,
  getReactionsForMessage,
  getReactionsForMessages,
  toggleReaction,
  insertMessage,
  getFilesByIds,
  getAllParticipantNames,
  insertMention,
  ensureRoom,
 getMessageRoom,
  type MessageRow,
} from "../db.js";
import { requireAuth } from "../auth.js";
import { requireJson } from "../lib/json-content-type.js";
import { addSubscriber, broadcast, markThinkingIdle, broadcastAgentIdle, broadcastDeleted, broadcastReaction } from "../stream.js";
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

function toMessage(
  r: MessageRow,
  reactionsMap?: Map<string, { emoji: string; count: number }[]>,
): Message {
  const msg: Message = {
    id: r.id,
    participantId: r.participant_id,
    authorName: r.author_name,
    content: r.content,
    createdAt: r.created_at,
    room: r.room,
  };
  const attachments = parseAttachments(r.attachments);
  if (attachments) msg.attachments = attachments;
  if (r.reply_to_id) msg.replyToId = r.reply_to_id;
  if (r.deleted) msg.deleted = true;
  const reactions = reactionsMap?.get(r.id) ?? getReactionsForMessage(r.id);
  if (reactions.length) msg.reactions = reactions as Reaction[];
  return msg;
}

// POST /messages { content?, attachmentIds? } -> Message
// content is optional iff at least one attachment is supplied (plan §1 — a bare
// screenshot is the most common intent, forcing text would add friction). The
// cross-field rule is enforced here, not in zod, because zod can't express it.
messages.post("/", requireJson, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreateMessageRequest.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, 400);
  }
  const { content, attachmentIds, replyToId, room } = parsed.data;

  // Defensive: content length is validated at the zod layer, but we enforce
  // a hard server-side cap to protect against oversized payloads that could
  // impact storage or delivery performance.
  const MAX_CONTENT_LENGTH = 100_000; // 100k characters
  if (content.length > MAX_CONTENT_LENGTH) {
    return c.json({ error: `content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters` }, 400);
  }

  // Validate attachment count to prevent abuse. The client-side SDK enforces
  // this too; this is the authoritative server-side check.
  const MAX_ATTACHMENTS = 10;
  if (attachmentIds.length > MAX_ATTACHMENTS) {
    return c.json({ error: `too many attachments (max ${MAX_ATTACHMENTS})` }, 400);
  }

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
      ...(r.filename ? { filename: r.filename } : {}),
    }));
  }

  // Cross-field rule: text OR image. Empty text with no images is rejected.
  if (!content.trim() && attachments.length === 0) {
    return c.json({ error: "content or attachment required" }, 400);
  }

  const me = c.get("participant");
  const id = ulid();
  const createdAt = Date.now();
  // Auto-create the room if it doesn't exist yet (PRD §9.4: posting into a
  // non-existent-but-valid room builds it — "build" and "enter" are the same
  // action in the open model). "general" always already exists from the
  // migration seed, so the common path is a no-op.
  ensureRoom(room, createdAt);
  insertMessage(
    id,
    me.id,
    content,
    createdAt,
    attachments.length > 0 ? JSON.stringify(attachments) : null,
    replyToId ?? null,
    room,
  );

  // Persist a per-participant inbox row for everyone @-mentioned in the text.
  // The recipient list is computed server-side (see mention.ts) so it is the
  // single source of truth — clients no longer have to each re-derive it, and
  // an offline recipient still finds the mention on next poll. We do NOT
  // exclude the author: the client-side `listen --mention` matcher doesn't
  // either, so the inbox must agree with what a live listen would have caught.
  // Each mention carries `room` so a cross-room @mention can deep-link the
  // recipient to the source room + message (MR11).
  const mentioned = extractMentionedParticipants(
    content,
    getAllParticipantNames(),
  );
  for (const m of mentioned) {
    insertMention(ulid(), id, m.id, me.id, room, createdAt);
  }

  const msg: Message = {
    id,
    participantId: me.id,
    authorName: me.name,
    content,
    createdAt,
    room,
  };
  if (attachments.length > 0) msg.attachments = attachments;
  if (replyToId) msg.replyToId = replyToId;
  broadcast(msg);

  // A reply landing is the most reliable "done thinking" signal — clear this
  // author's indicator right now, regardless of whether their client also
  // reports idle. Category-blind: any participant who reported thinking (an
  // agent processing a @mention OR a human typing) is cleared on post — the
  // safety net for a client that crashes right after posting, so its own idle
  // report never fires. The idle event carries the room they were thinking in
  // (if any) so the clear reaches the same room-scoped subscribers that saw it.
  const entry = markThinkingIdle(me.id);
  if (entry) {
    broadcastAgentIdle({
      participantId: me.id,
      ...(entry.room ? { room: entry.room } : {}),
    });
  }
  return c.json(msg, 201);
});

// GET /messages?room=<slug>&since=<id>&before=<id>&limit=<n> -> Message[]
// (chronologic). `room` defaults to "general" for backward compatibility — an
// old client that omits it sees the general history exactly as before.
messages.get("/", (c) => {
  const room = c.req.query("room") ?? "general";
  const since = c.req.query("since");
  const before = c.req.query("before");
  const limit = parseLimit(c.req.query("limit"));
  // `before` (older history, scroll-up pagination) takes precedence over
  // `since`; they aren't combined in practice, but if both appear we serve the
  // backward page so the UI's "load earlier" never accidentally pulls newer.
  const rows = before
    ? getMessagesBeforeId(before, room, limit)
    : since
      ? getMessagesSince(since, room, limit).messages
      : getRecentMessages(room, limit);
  const reactionsMap = getReactionsForMessages(rows.map((r) => r.id));
  return c.json(rows.map((r) => toMessage(r, reactionsMap)));
});

// Maximum search query length. Beyond this the LIKE pattern gets too large
// and is rarely useful; capping avoids O(n) pattern construction on huge input.
const SEARCH_QUERY_MAX = 500;

// GET /messages/search?q=<text>&room=<slug>&limit=<n> -> Message[] (newest first)
// `room` is optional: omit to search across all rooms, pass a slug to scope it.
messages.get("/search", (c) => {
  const raw = (c.req.query("q") ?? "").trim();
  if (!raw) return c.json([]);
  const q = raw.length > SEARCH_QUERY_MAX ? raw.slice(0, SEARCH_QUERY_MAX) : raw;
  const limit = parseLimit(c.req.query("limit"));
  const room = c.req.query("room");
  const rows = searchMessages(q, room || null, limit);
  const reactionsMap = getReactionsForMessages(rows.map((r) => r.id));
  return c.json(rows.map((r) => toMessage(r, reactionsMap)));
});

// DELETE /messages/:id -> 204 (recall). Only the author may (participant_id
// check in deleteMessage). Broadcasts `message_deleted` so every client hides
// the content and shows a "recalled" placeholder instead. The event carries the
// message's room so the fan-out stays room-scoped (a client watching another
// room never sees the recall). Soft-delete keeps the row, so the room is still
// readable after the successful update.
messages.delete("/:id", async (c) => {
  const me = c.get("participant");
  const id = c.req.param("id");
  const ok = deleteMessage(id, me.id);
  if (!ok) return c.json({ error: "not found" }, 404);
  const room = getMessageRoom(id) ?? "general";
  broadcastDeleted({ id, room });
  return c.body(null, 204);
});

// POST /messages/:id/reactions { emoji } -> 204 (toggles). Broadcasts
// `message_reaction` with the refreshed aggregate so all clients update. The
// event carries the message's room so the fan-out stays room-scoped.
messages.post("/:id/reactions", requireJson, async (c) => {
  const me = c.get("participant");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const emoji = typeof body.emoji === "string" ? body.emoji.trim() : "";
  if (!emoji || emoji.length > 32) return c.json({ error: "bad emoji" }, 400);
  const reactions = toggleReaction(id, me.id, emoji);
  const room = getMessageRoom(id) ?? "general";
  broadcastReaction({ messageId: id, reactions: reactions as Reaction[], room } satisfies MessageReactionEvent);
  return c.body(null, 204);
});

// GET /messages/stream  (SSE) — live message feed, optionally room-scoped.
// `?room=<slug>` subscribes to a single room; `?rooms=a,b` to several; omitted
// subscribes to all rooms. Room-scoped events (message / message_deleted /
// message_reaction / agent_thinking / agent_idle) are filtered server-side so a
// client focused on room A never pays for room B's traffic (MR10). Presence
// stays global (PRD §8.7) — a roster is connection-level, not per-room.
messages.get("/stream", (c) => {
  // Parse the room filter into a Set (or null = all rooms). An explicit but
  // empty filter (e.g. `?rooms=` with no valid slugs) is treated as "all",
  // matching the forgiving spirit of the single-room `?room=` default.
  const roomParam = c.req.query("room");
  const roomsParam = c.req.query("rooms");
  let roomSet: Set<string> | null = null;
  if (roomParam !== undefined || roomsParam !== undefined) {
    const names = (roomsParam ?? roomParam ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    roomSet = names.length > 0 ? new Set(names) : null;
  }
  return streamSSE(c, async (stream) => {
    const unsubscribe = addSubscriber(stream, c.get("participant"), roomSet);
    stream.onAbort(() => {
      unsubscribe();
    });
    // Keep the stream open until the client disconnects. hono/streaming keeps
    // the connection alive while the callback is pending; the short sleeper
    // bounds wakeups without doing anything useful.
    while (true) {
      await new Promise((r) => setTimeout(r, 30000));
    }
  });
});