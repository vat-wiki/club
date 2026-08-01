import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { ulid } from "ulid";

import {
  CreateMessageRequest,
  DEFAULT_CHANNEL,
  EditMessageRequest,
  isValidId,
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
  ensureChannel,
  getAllParticipantNames,
  getFilesByIds,
  getMessageById,
  getMessageChannel,
  getMessagesAround,
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
  updateMessage,
} from "../db.js";
import { getChannelQuery, jsonErr, parseJsonBody, parseLimit, requireValidChannelSlug,requireValidId } from "../lib.js";
import { requireJson } from "../lib/json-content-type.js";
import { extractMentionedParticipants } from "../mention.js";
import { clientIpKey, rateLimit } from "../rate-limit.js";
import { addSubscriber, broadcast, broadcastAgentIdle, broadcastDeleted, broadcastEdited, broadcastReaction, markThinkingIdle } from "../stream.js";

export const messages = new Hono();

messages.use("*", requireAuth);

// Tighter limiter on write paths: POST /messages, POST /messages/:id/reactions,
// DELETE /messages/:id. The global 120/min is fine for reads but generous
// enough for abuse on writes (spam, reaction-flooding, recall-storming). 15/min
// per IP keeps legitimate use unaffected while making scripted abuse impractical.
// Disabled in test mode (NODE_ENV=test) so e2e suites don't hit the ceiling.
// `key: clientIpKey` is mandatory: without it the limiter keys on "unknown" and
// the 15/min cap collapses to a single site-wide bucket (concurrent users trip
// 429s and POST /messages "often fails").
const isTest = process.env.NODE_ENV === "test";
const writeLimiter = isTest
  ? undefined
  : rateLimit({ max: 15, windowMs: 60_000, key: clientIpKey });

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
): Response | undefined {
  const since = c.req.query("since");
  if (since !== undefined) {
    const bad = requireValidId(c, since, "since id");
    if (bad) return bad.r;
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
): Response | undefined {
  const before = c.req.query("before");
  if (before !== undefined) {
    const bad = requireValidId(c, before, "before id");
    if (bad) return bad.r;
  }
  return undefined;
}

/**
 * Validate that `around` is a non-empty query parameter.
 *
 * Same contract as `requireValidSinceQuery` / `requireValidBeforeQuery`:
 * `around` is optional (omit → paginated/recent history), but when supplied it
 * must look like a valid message id before the DB is consulted. This keeps the
 * context-window entry point consistent with the `since` / `before` paths and
 * with the id-bearing delete/reaction routes.
 *
 * @returns `{ error, status }` to use as an early return, or `undefined` when
 *   `around` is absent or valid.
 */
function requireValidAroundQuery(
  c: Context,
): Response | undefined {
  const around = c.req.query("around");
  if (around !== undefined) {
    const bad = requireValidId(c, around, "around id");
    if (bad) return bad.r;
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
    content: r.deleted ? "" : r.content,
    createdAt: r.created_at,
    channel: r.channel,
  };
  const attachments = parseAttachments(r.attachments);
  if (attachments) msg.attachments = attachments;
  if (r.reply_to_id) msg.replyToId = r.reply_to_id;
  if (r.deleted) msg.deleted = true;
  // `edited_at` is NULL until the author edits; mirroring the conditional set
  // used for `replyToId` / `deleted` keeps an unedited message free of the
  // field rather than serializing `editedAt: null` to the API/SSE payload.
  if (r.edited_at) msg.editedAt = r.edited_at;
  // Batched list/search paths pre-fetched reactions via getReactionsForMessages().
  // Keys absent from the map have no reactions (empty); when the map is
  // omitted, fall back to the per-message query. The `?? []` guard keeps
  // the expression single-line while preserving the existing "absent key =
  // empty, no map = query DB" contract.
  const reactions = reactionsMap?.get(r.id) ?? getReactionsForMessage(r.id);
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
  const { content, attachmentIds, replyToId, channel } = parsed.data;
  // Security: validate `replyToId` server-side. If the client supplies a
  // replyToId that doesn't exist OR points to a message in a different channel,
  // we must reject it. Otherwise an attacker can reply-to-phantom-message
  // (information leak / confusion vector) or reply across channels, creating
  // cross-channel thread injection that confuses UI clients which assume a
  // thread stays within its channel. The Zod schema only enforces length
  // (min 1, max 64), so we must also reject malformed ids (spaces, slashes,
  // control chars) before touching the DB — the same hygiene applied to
  // since/before query params in GET /messages.
  if (replyToId) {
    if (!isValidId(replyToId)) {
      return jsonErr(c, "bad replyToId", 400);
    }
    const replyChannel = getMessageChannel(replyToId);
    if (!replyChannel) {
      return jsonErr(c, "reply target not found", 404);
    }
    if (replyChannel !== channel) {
      return jsonErr(c, "reply target not in channel", 400);
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
    } catch (err) {
      // DB errors and input violations (e.g. too many ids) must not leak
      // internal diagnostics to the caller. Log for operator visibility.
      console.error("[club server] message attachments unavailable:", err);
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
  // Auto-create the channel if it doesn't exist yet (PRD §9.4: posting into a
  // non-existent-but-valid channel builds it — "build" and "enter" are the same
  // action in the open model). "general" always already exists from the
  // migration seed, so the common path is a no-op.
  ensureChannel(channel, createdAt);
  insertMessage(
    id,
    me.id,
    cleanContent,
    createdAt,
    attachments.length > 0 ? JSON.stringify(attachments) : null,
    replyToId ?? null,
    channel,
  );

  // Persist a per-participant inbox row for everyone @-mentioned in the text.
  // The recipient list is computed server-side (see mention.ts) so it is the
  // single source of truth — clients no longer have to each re-derive it, and
  // an offline recipient still finds the mention on next poll. We do NOT
  // exclude the author: the client-side `listen --mention` matcher doesn't
  // either, so the inbox must agree with what a live listen would have caught.
  // Each mention carries `channel` so a cross-channel @mention can deep-link the
  // recipient to the source channel + message (MR11).
  const mentioned = extractMentionedParticipants(
    cleanContent,
    getAllParticipantNames(),
  );
  const mentionRows: MentionInsert[] = mentioned.map((m) => ({
    id: ulid(),
    messageId: id,
    participantId: m.id,
    authorId: me.id,
    channel,
    createdAt,
  }));
  if (mentionRows.length > 0) insertMentions(mentionRows);

  const msg: Message = {
    id,
    participantId: me.id,
    authorName: me.name,
    content: cleanContent,
    createdAt,
    channel,
  };
  if (attachments.length > 0) msg.attachments = attachments;
  if (replyToId) msg.replyToId = replyToId;
  broadcast(msg);

  // A reply landing is the most reliable "done thinking" signal — clear this
  // author's indicator right now, regardless of whether their client also
  // reports idle. Category-blind: any participant who reported thinking (an
  // agent processing a @mention OR a human typing) is cleared on post — the
  // safety net for a client that crashes right after posting, so its own idle
  // report never fires. An agent may have been thinking in more than one channel,
  // so we clear ALL of its entries and broadcast an idle into each one's channel
  // - otherwise the indicator sticks in the rooms whose idle was never sent.
  const entries = markThinkingIdle(me.id);
  for (const entry of entries) {
    broadcastAgentIdle({
      participantId: me.id,
      ...(entry.channel ? { channel: entry.channel } : {}),
    });
  }
  return c.json(msg, 201);
});

// GET /messages?channel=<slug>&since=<id>&before=<id>&around=<id>&limit=<n> -> Message[]
// (chronologic). `channel` defaults to "general" for backward compatibility — an
// old client that omits it sees the general history exactly as before.
messages.get("/", (c) => {
  const channelOrErr = getChannelQuery(c);
  if (!channelOrErr.ok) return channelOrErr.r;
  const { channel } = channelOrErr;
  const since = c.req.query("since");
  const before = c.req.query("before");
  const around = c.req.query("around");
  const limit = parseLimit(c.req.query("limit"));
  // Validate `since`/`before`/`around` query params before any DB call. The dedicated
  // helpers (requireValidSinceQuery / requireValidBeforeQuery /
  // requireValidAroundQuery) wrap the id-format check so the route reads like a
  // single guard list; see their JSDoc for why invalid ids are rejected up-front
  // rather than passed through.
  const badSince = requireValidSinceQuery(c);
  if (badSince) return badSince;
  const badBefore = requireValidBeforeQuery(c);
  if (badBefore) return badBefore;
  const badAround = requireValidAroundQuery(c);
  if (badAround) return badAround;
  // `around` (context window: a few before + the anchor + a few after) takes
  // precedence over `before`/`since`; the three are distinct pagination modes
  // and aren't combined in practice. If several appear we serve the context
  // window — a reader asking for context around an id wants that, not a
  // one-sided page.
  const rows = around
    ? getMessagesAround(around, channel, limit)
    : before
      ? getMessagesBeforeId(before, channel, limit)
      : since
        ? getMessagesSince(since, channel, limit).messages
        : getRecentMessages(channel, limit);
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

// GET /messages/search?q=<text>&channel=<slug>&limit=<n> -> Message[] (newest first)
// `channel` is optional: omit to search across all channels, pass a slug to scope it.
messages.get("/search", (c) => {
  const raw = (c.req.query("q") ?? "").trim();
  if (!raw) return c.json([]);
  const q = raw.length > SEARCH_QUERY_MAX ? raw.slice(0, SEARCH_QUERY_MAX) : raw;
  const limit = parseLimit(c.req.query("limit"));
  const rawChannel = c.req.query("channel")?.trim();
  if (rawChannel !== undefined) {
    const bad = requireValidChannelSlug(c, rawChannel);
    if (bad) return bad.r;
  }
  const channel = rawChannel ?? null;
  const rows = searchMessages(q, channel, limit);
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
// message's channel so the fan-out stays channel-scoped (a client watching another
// channel never sees the recall). Soft-delete keeps the row, so the channel is still
// readable after the successful update.
messages.delete("/:id", writeGuard, (c) => {
  const me = c.get("participant");
  const id = c.req.param("id");
  const bad = requireValidId(c, id, "message id");
  if (bad) return bad.r;
  const { ok, channel } = deleteMessage(id, me.id);
  if (!ok) return jsonErr(c, "not found", 404);
  broadcastDeleted({ id, channel: channel ?? DEFAULT_CHANNEL });
  return c.body(null, 204);
});

// PATCH /messages/:id { content } -> Message (edit).
// Only the author may edit (enforced in updateMessage). Returns the updated
// message on success; returns 404 when the message is unknown, not owned by the
// caller, or already recalled. Content is re-sanitized at edit time so a
// previously-sanitized message can't later be edited into something that
// violates the control-character policy.
messages.patch("/:id", requireJson, writeGuard, async (c) => {
  const me = c.get("participant");
  const id = c.req.param("id");
  const bad = requireValidId(c, id, "message id");
  if (bad) return bad.r;
  const parsed = await parseJsonBody(c, EditMessageRequest, "bad content");
  if (!parsed.ok) return parsed.r;
  const { content } = parsed.data;
  const cleanContent = sanitizeContent(content);
  if (!cleanContent.trim()) {
    return jsonErr(c, "content required");
  }
  const { ok } = updateMessage(id, me.id, cleanContent);
  if (!ok) return jsonErr(c, "not found", 404);
  const row = getMessageById(id);
  if (!row) return jsonErr(c, "not found", 500);
  const msg: Message = toMessage(row);
  // Broadcast the edit live so every SSE subscriber in the channel swaps the
  // message in by id (replacing content/editedAt) rather than waiting for a
  // history poll. The event carries the channel so the fan-out stays scoped.
  broadcastEdited({ message: msg, channel: msg.channel });
  return c.json(msg, 200);
});

// POST /messages/:id/reactions { emoji } -> 204 (toggles). Broadcasts
// `message_reaction` with the refreshed aggregate so all clients update. The
// event carries the message's channel so the fan-out stays channel-scoped.
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
  const { reactions, channel } = toggleReaction(id, me.id, trimmed);
  broadcastReaction({ messageId: id, reactions: reactions as Reaction[], channel: channel ?? DEFAULT_CHANNEL } satisfies MessageReactionEvent);
  return c.body(null, 204);
});

// GET /messages/stream  (SSE) — live message feed, optionally channel-scoped.
// `?channel=<slug>` subscribes to a single channel; `?channels=a,b` to several; omitted
// subscribes to all channels. Channel-scoped events (message / message_edited / message_deleted /
// message_reaction / agent_thinking / agent_idle) are filtered server-side so a
// client focused on channel A never pays for channel B's traffic (MR10). Presence
// stays global (PRD §8.7) — a roster is connection-level, not per-channel.
messages.get("/stream", (c) => {
  // Parse the channel filter into a Set (or null = all channels). An explicit but
  // empty filter (e.g. `?channels=` with no valid slugs) is treated as "all",
  // matching the forgiving spirit of the single-channel `?channel=` default.
  const channelParam = c.req.query("channel")?.trim();
  const channelsParam = c.req.query("channels")?.trim();
  // Validate every supplied channel slug before wiring it into the SSE
  // fan-out. Invalid slugs (containing newlines, slashes, etc.) would
  // otherwise be injected verbatim into `addSubscriber`'s Set and could
  // break SSE framing. Each split name is validated through the same
  // centralized `requireValidChannelSlug` validator used by POST /channels.
  if (channelParam !== undefined) {
    const bad = requireValidChannelSlug(c, channelParam);
    if (bad) return bad.r;
  }
  let channelSet: Set<string> | null = null;
  if (channelParam !== undefined || channelsParam !== undefined) {
    const names = (channelsParam ?? channelParam ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const n of names) {
      const bad = requireValidChannelSlug(c, n);
      if (bad) return bad.r;
    }
    channelSet = names.length > 0 ? new Set(names) : null;
  }
  return streamSSE(c, async (stream) => {
    const unsubscribe = addSubscriber(stream, c.get("participant"), channelSet);
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