import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { ulid } from "ulid";
import {
  DEFAULT_ROOM,
  CreateMessageRequest,
  ToggleReactionRequest,
  MAX_IMAGES_PER_MESSAGE,
  MAX_MESSAGE_CONTENT,
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
import { parseLimit, jsonErr, parseJsonBody, requireValidRoomSlug } from "../lib.js";
import { extractMentionedParticipants } from "../mention.js";

export const messages = new Hono();

messages.use("*", requireAuth);

// Performance: attachment JSON is immutable per message row. Across history,
// search, and SSE fan-out the same raw string is re-parsed on every call. A
// LRU cache keyed on the raw JSON string amortizes the parse cost: the first
// call parses; subsequent calls (common — history renders re-request the same
// rows as the user scrolls) return a reference to the cached array. The cache
// is bounded (MAX_ATTACHMENT_CACHE = 512) so a pathological burst of unique
// payloads can't grow unbounded memory; 512 entries is far above the realistic
// per-request batch size (default LIMIT 50, max 200). Because the cached
// value is a plain object never mutated by callers, safe to share across
// requests.
//
// NOTE: we only cache *non-null* parse results (the parsed array). Plain-text
// rows return undefined on every call without a cache lookup — the vast
// majority of messages have no attachments, so caching the undefined sentinel
// would be a cache-miss tax for no benefit.

const MAX_ATTACHMENT_CACHE = 512;
const attachmentCache = new Map<string, MessageAttachment[]>();

function parseAttachments(raw: string | null): MessageAttachment[] | undefined {
  // Fast path: null/empty → no attachments (no cache lookup needed).
  if (!raw) return undefined;
  let cached = attachmentCache.get(raw);
  if (cached !== undefined) return cached;

  // Miss: parse once, cache only if the result is a real array.
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      cached = parsed as MessageAttachment[];
      attachmentCache.set(raw, cached);
      // Evict oldest entry when the cache is full to keep memory bounded.
      if (attachmentCache.size > MAX_ATTACHMENT_CACHE) {
        const firstKey = attachmentCache.keys().next().value;
        if (firstKey !== undefined) attachmentCache.delete(firstKey);
      }
      return cached;
    }
  } catch {
    // Malformed JSON → treat as no attachments (matches legacy behavior).
  }
  return undefined;
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
  const parsed = await parseJsonBody<typeof CreateMessageRequest._output>(c, CreateMessageRequest, "bad request");
  if (!parsed.ok) return parsed.r;
  const { content, attachmentIds, replyToId, room } = parsed.data;

  // content length is already capped by zod (MAX_MESSAGE_CONTENT), but we keep
  // a cheap server-side guard so malformed payloads are rejected deterministically
  // even if the schema changes. The threshold mirrors the schema constant so the
  // two can never drift.
  if (content.length > MAX_MESSAGE_CONTENT) {
    return jsonErr(c, `content exceeds maximum length of ${MAX_MESSAGE_CONTENT} characters`);
  }

  // Rehydrate attachments server-side from the requested ids. The server is the
  // sole source of truth for mime/width/height/size, so the client only sends
  // ids — dimensions can't be forged. We also enforce that every requested id
  // exists AND belongs to the sender: a participant can only attach files it
  // uploaded, never another participant's. attachment count is capped by
  // MAX_IMAGES_PER_MESSAGE (shared server/client/MCP limit).
  if (attachmentIds.length > MAX_IMAGES_PER_MESSAGE) {
    return jsonErr(c, `too many attachments (max ${MAX_IMAGES_PER_MESSAGE})`);
  }

  let attachments: MessageAttachment[] = [];
  if (attachmentIds.length > 0) {
    try {
      const rows = getFilesByIds(attachmentIds);
      // Reject if any id is missing or doesn't belong to this participant.
      if (rows.length !== attachmentIds.length) {
        return jsonErr(c, "attachment not found");
      }
      if (rows.some((r) => r.participant_id !== c.get("participant").id)) {
        return jsonErr(c, "attachment not owned by sender", 403);
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
    } catch {
      // DB errors and input violations (e.g. too many ids) must not leak
      // internal diagnostics to the caller.
      return jsonErr(c, "attachments unavailable", 500);
    }
  }

  // Cross-field rule: text OR image. Empty text with no images is rejected.
  if (!content.trim() && attachments.length === 0) {
    return jsonErr(c, "content or attachment required");
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
  const room = (c.req.query("room") ?? DEFAULT_ROOM).trim();
  const bad = requireValidRoomSlug(c, room);
  if (bad) return bad.r;
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
  // Pre-fill missing message ids with empty reaction arrays so toMessage()
  // never triggers its per-row fallback query on the list hot path.
  for (const r of rows) reactionsMap.set(r.id, reactionsMap.get(r.id) ?? []);
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
  const rawRoom = c.req.query("room")?.trim();
  if (rawRoom !== undefined) {
    const bad = requireValidRoomSlug(c, rawRoom);
    if (bad) return bad.r;
  }
  const room = rawRoom ?? null;
  const rows = searchMessages(q, room ?? null, limit);
  const reactionsMap = getReactionsForMessages(rows.map((r) => r.id));
  // Pre-fill missing message ids with empty reaction arrays so toMessage()
  // never triggers its per-row fallback query on the search hot path.
  for (const r of rows) reactionsMap.set(r.id, reactionsMap.get(r.id) ?? []);
  return c.json(rows.map((r) => toMessage(r, reactionsMap)));
});

// DELETE /messages/:id -> 204 (recall). Only the author may (participant_id
// check in deleteMessage). Broadcasts `message_deleted` so every client hides
// the content and shows a "recalled" placeholder instead. The event carries the
// message's room so the fan-out stays room-scoped (a client watching another
// room never sees the recall). Soft-delete keeps the row, so the room is still
// readable after the successful update.
messages.delete("/:id", (c) => {
  const me = c.get("participant");
  const id = c.req.param("id");
  const ok = deleteMessage(id, me.id);
  if (!ok) return jsonErr(c, "not found", 404);
  const room = getMessageRoom(id) ?? DEFAULT_ROOM;
  broadcastDeleted({ id, room });
  return c.body(null, 204);
});

// POST /messages/:id/reactions { emoji } -> 204 (toggles). Broadcasts
// `message_reaction` with the refreshed aggregate so all clients update. The
// event carries the message's room so the fan-out stays room-scoped.
messages.post("/:id/reactions", requireJson, async (c) => {
  const me = c.get("participant");
  const id = c.req.param("id");
  const parsed = await parseJsonBody<typeof ToggleReactionRequest._output>(
    c,
    ToggleReactionRequest,
    "bad emoji",
  );
  if (!parsed.ok) return parsed.r;
  const { emoji } = parsed.data;
  const trimmed = emoji.trim();
  // Security: strip ASCII control characters (NUL, SOH, STX, ..., DEL) so
  // control-char injection can't reach the DB through direct API calls
  // (curl, SDK, MCP). The CLI client does the same in react.ts, but the
  // server must be the last line of defense — it can't trust any caller.
  const clean = trimmed.replace(/[\x00-\x1f\x7f]/g, "");
  if (!clean) return jsonErr(c, "bad emoji");
  const reactions = toggleReaction(id, me.id, clean);
  const room = getMessageRoom(id) ?? DEFAULT_ROOM;
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
  const roomParam = c.req.query("room")?.trim();
  const roomsParam = c.req.query("rooms")?.trim();
  // Validate every supplied room slug before wiring it into the SSE
  // fan-out. Invalid slugs (containing newlines, slashes, etc.) would
  // otherwise be injected verbatim into `addSubscriber`'s Set and could
  // break SSE framing. Each split name is validated through the same
  // centralized `requireValidRoomSlug` validator used by POST /rooms.
  if (roomParam !== undefined) {
    const bad = requireValidRoomSlug(c, roomParam);
    if (bad) return bad.r;
  }
  let roomSet: Set<string> | null = null;
  if (roomParam !== undefined || roomsParam !== undefined) {
    const names = (roomsParam ?? roomParam ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const n of names) {
      const bad = requireValidRoomSlug(c, n);
      if (bad) return bad.r;
    }
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