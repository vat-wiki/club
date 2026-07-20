import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { ulid } from "ulid";

import {
  CreateMessageRequest,
  DEFAULT_ROOM,
  type Message,
  type MessageAttachment,
  type MessageReactionEvent,
  type Reaction,
  sanitizeContent,
  ToggleReactionRequest,
} from "@club/shared";

import { parseAttachments } from "./attachment-cache.js";
import { requireAuth } from "../auth.js";
import {
  deleteMessage,
  ensureRoom,
  getAllParticipantNames,
  getFilesByIds,
 getMessageRoom,
  getMessagesBeforeId,
  getMessagesSince,
  getReactionsForMessage,
  getReactionsForMessages,
  getRecentMessages,
  insertMentions,
  insertMessage,
  type MentionInsert,
  type MessageRow,
  searchMessages,
  toggleReaction,
} from "../db.js";
import { getRoomQuery, jsonErr, parseJsonBody, parseLimit, requireValidId, requireValidRoomSlug } from "../lib.js";
import { requireJson } from "../lib/json-content-type.js";
import { extractMentionedParticipants } from "../mention.js";
import { rateLimit } from "../rate-limit.js";
import { addSubscriber, broadcast, broadcastAgentIdle, broadcastDeleted, broadcastReaction, markThinkingIdle } from "../stream.js";

export const messages = new Hono();

messages.use("*", requireAuth);

// Tighter limiter on write paths: POST /messages, POST /messages/:id/reactions,
// DELETE /messages/:id. The global 120/min is fine for reads but generous
// enough for abuse on writes (spam, reaction-flooding, recall-storming). 15/min
// per IP keeps legitimate use unaffected while making scripted abuse impractical.
// Disabled in test mode (NODE_ENV=test) so e2e suites don't hit the ceiling.
const isTest = process.env.NODE_ENV === "test";
const writeLimiter = isTest
  ? undefined
  : rateLimit({ max: 15, windowMs: 60_000 });

// Typed identity middleware so the write-path guard can conditionally use
// writeLimiter or a no-op at compile time (Hono's variadic overload needs a
// value whose type is exactly MiddlewareHandler, which `??` + a lambda doesn't
// satisfy).
const identityMiddleware: import("hono").MiddlewareHandler = async (_, next) =>
  next();
const writeGuard: import("hono").MiddlewareHandler = writeLimiter ?? identityMiddleware;

/**
 * Validate that `since` is a non-empty query parameter.
 *
 * Since is optional (omit → full recent history), but when supplied it must
 * look like a valid message id before we do any DB work. An invalid `since`
 * would otherwise be passed straight into `getMessagesSince()` and waste a
 * prepared-statement round-trip only to return [] — and behave inconsistently
 * with DELETE /messages/:id and other id-bearing routes, which reject garbage
 * input up-front.
 *
 * @returns `{ error, status }` to use as an early return, or `undefined` when
 *   `since` is absent or valid.
 */
function requireValidSinceQuery(
  c: Context,
): { error: string; status: number } | undefined {
  const since = c.req.query("since");
  if (since !== undefined) {
    const bad = requireValidId(c, since, "since id");
    if (bad) return { error: bad.r.statusText, status: 400 };
  }
  return undefined;
}

/**
 * Validate that `before` is a non-empty query parameter.
 *
 * Same contract as `requireValidSinceQuery`: `before` is optional (omit →
 * forward pagination), but when supplied it must look like a valid message id
 * before the DB is consulted. This keeps the backward-pagination entry point
 * consistent with the forward-pagination `since` path and with the id-bearing
 * delete/reaction routes.
 *
 * @returns `{ error, status }` to use as an early return, or `undefined` when
 *   `before` is absent or valid.
 */
function requireValidBeforeQuery(
  c: Context,
): { error: string; status: number } | undefined {
  const before = c.req.query("before");
  if (before !== undefined) {
    const bad = requireValidId(c, before, "before id");
    if (bad) return { error: bad.r.statusText, status: 400 };
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
  // reactionsMap is only supplied on the batched list/search paths, where
  // every message id was passed to getReactionsForMessages(). Keys that have
  // no reactions are simply absent from the map; toMessage must distinguish
  // "absent (maybe empty)" from "map not supplied at all" to preserve the
  // existing per-row fallback for single-message routes.
  const reactions =
    reactionsMap?.has(r.id) ? (reactionsMap.get(r.id) ?? []) : getReactionsForMessage(r.id);
  if (reactions.length) msg.reactions = reactions as Reaction[];
  return msg;
}

// POST /messages { content?, attachmentIds? } -> Message
// content is optional iff at least one attachment is supplied (plan §1 — a bare
// screenshot is the most common intent, forcing text would add friction). The
// cross-field rule is enforced here, not in zod, because zod can't express it.
messages.post("/", requireJson, writeGuard, async (c) => {
  const parsed = await parseJsonBody(c, CreateMessageRequest, "bad request");
  if (!parsed.ok) return parsed.r;
  const { content, attachmentIds, replyToId, room } = parsed.data;
  // Security: validate `replyToId` server-side. If the client supplies a
  // replyToId that doesn't exist OR points to a message in a different room,
  // we must reject it. Otherwise an attacker can reply-to-phantom-message
  // (information leak / confusion vector) or reply across rooms, creating
  // cross-room thread injection that confuses UI clients which assume a
  // thread stays within its room. The format is already validated by the
  // Zod schema (min 1, max 64), but existence + room-scope must be checked
  // in the DB because the schema has no cross-row knowledge.
  if (replyToId) {
    const replyRoom = getMessageRoom(replyToId);
    if (!replyRoom) {
      return jsonErr(c, "reply target not found", 404);
    }
    if (replyRoom !== room) {
      return jsonErr(c, "reply target not in room", 400);
    }
  }
  // Sanitize the message body once at ingestion. The sanitized copy is the
  // sole source of truth from here on — stored in DB and broadcast via SSE.
  // Stripping control characters protects the SSE JSON frame boundary and
  // prevents invisible delimiters from reaching CLI/SDK/MCP consumers.
  const cleanContent = sanitizeContent(content);

  // Attachments are rehydrated server-side from the requested ids; the server
  // is the sole source of truth for mime/width/height/size, so the client only
  // sends ids — dimensions can't be forged. We also enforce that every
  // requested id exists AND belongs to the sender: a participant can only
  // attach files it uploaded, never another participant's. The cap on count
  // is already enforced by the Zod schema (MAX_IMAGES_PER_MESSAGE), so no
  // separate server-side check is needed.
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
  // Re-checked against cleanContent since sanitization can reduce a text-only
  // payload to empty.
  if (!cleanContent.trim() && attachments.length === 0) {
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
    cleanContent,
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
    cleanContent,
    getAllParticipantNames(),
  );
  const mentionRows: MentionInsert[] = mentioned.map((m) => ({
    id: ulid(),
    messageId: id,
    participantId: m.id,
    authorId: me.id,
    room,
    createdAt,
  }));
  if (mentionRows.length > 0) insertMentions(mentionRows);

  const msg: Message = {
    id,
    participantId: me.id,
    authorName: me.name,
    content: cleanContent,
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
  const roomOrErr = getRoomQuery(c);
  if (!roomOrErr.ok) return roomOrErr.r;
  const { room } = roomOrErr;
  const since = c.req.query("since");
  const before = c.req.query("before");
  const limit = parseLimit(c.req.query("limit"));
  // Validate `since`/`before` query params before any DB call. The dedicated
  // helpers (requireValidSinceQuery / requireValidBeforeQuery) wrap the
  // id-format check so the route reads like a single guard list; see their
  // JSDoc for why invalid ids are rejected up-front rather than passed through.
  const badSince = requireValidSinceQuery(c);
  if (badSince) return jsonErr(c, badSince.error, badSince.status);
  const badBefore = requireValidBeforeQuery(c);
  if (badBefore) return jsonErr(c, badBefore.error, badBefore.status);
  // `before` (older history, scroll-up pagination) takes precedence over
  // `since`; they aren't combined in practice, but if both appear we serve the
  // backward page so the UI's "load earlier" never accidentally pulls newer.
  const rows = before
    ? getMessagesBeforeId(before, room, limit)
    : since
      ? getMessagesSince(since, room, limit).messages
      : getRecentMessages(room, limit);
  const messageIds = rows.map((r) => r.id);
  const reactionsMap = getReactionsForMessages(messageIds);
  // `toMessage` uses reactionsMap.has(r.id) to distinguish "batched (maybe
  // empty)" from "not batched → per-row fallback". We intentionally do NOT
  // pre-fill missing ids with []: that would make msg.reactions truthy for
  // every message, defeating the if (reactions.length) guard in toMessage and
  // wasting Map slots for the common case of no reactions.
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
  const messageIds = rows.map((r) => r.id);
  const reactionsMap = getReactionsForMessages(messageIds);
  // `toMessage` uses reactionsMap.has(r.id) to distinguish "batched (maybe
  // empty)" from "not batched → per-row fallback", so only messages with no
  // reactions on the search hot path fall back to a single per-row query.
  return c.json(rows.map((r) => toMessage(r, reactionsMap)));
});

// DELETE /messages/:id -> 204 (recall). Only the author may (participant_id
// check in deleteMessage). Broadcasts `message_deleted` so every client hides
// the content and shows a "recalled" placeholder instead. The event carries the
// message's room so the fan-out stays room-scoped (a client watching another
// room never sees the recall). Soft-delete keeps the row, so the room is still
// readable after the successful update.
messages.delete("/:id", writeGuard, (c) => {
  const me = c.get("participant");
  const id = c.req.param("id");
  const bad = requireValidId(c, id, "message id");
  if (bad) return bad.r;
  const ok = deleteMessage(id, me.id);
  if (!ok) return jsonErr(c, "not found", 404);
  const room = getMessageRoom(id) ?? DEFAULT_ROOM;
  broadcastDeleted({ id, room });
  return c.body(null, 204);
});

// POST /messages/:id/reactions { emoji } -> 204 (toggles). Broadcasts
// `message_reaction` with the refreshed aggregate so all clients update. The
// event carries the message's room so the fan-out stays room-scoped.
messages.post("/:id/reactions", requireJson, writeGuard, async (c) => {
  const me = c.get("participant");
  const id = c.req.param("id");
  const bad = requireValidId(c, id, "message id");
  if (bad) return bad.r;
  const parsed = await parseJsonBody(
    c,
    ToggleReactionRequest,
    "bad emoji",
  );
  if (!parsed.ok) return parsed.r;
  const { emoji } = parsed.data;
  // Security: any ASCII control character in the emoji value is a hard
  // reject. Direct API callers (curl, SDK, MCP) bypass the CLI's
  // sanitizeEmoji(); the server is the last line of defense.
  // Rejection (rather than strip-and-accept) ensures an attacker can't
  // smuggle control bytes into the DB by wrapping them in visible emoji;
  // a payload that sanitizes to "hello" is still rejected because the raw
  // value contained injected bytes (e.g. "hello\x00").
  if (/[\x00-\x1f\x7f]/.test(emoji)) {
    return jsonErr(c, "bad emoji");
  }
  const trimmed = emoji.trim();
  if (!trimmed) return jsonErr(c, "bad emoji");
  const reactions = toggleReaction(id, me.id, trimmed);
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