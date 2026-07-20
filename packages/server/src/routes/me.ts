import { Hono } from "hono";
import type { Mention } from "@club/shared";
import { MarkMentionsReadRequest } from "@club/shared";
import { requireAuth } from "../auth.js";
import { jsonErr, parseJsonBody, requireValidId } from "../lib.js";
import {
  getUnreadMentions,
  getMentionById,
  getMentionFull,
  markMentionRead,
  markMentionsRead,
  type MentionRow,
} from "../db.js";

export const me = new Hono();
me.use("*", requireAuth);

// GET /me -> current participant
me.get("/", (c) => c.json(c.get("participant")));

// DB rows are snake_case; the API must return the shared Mention contract
// (camelCase). Mirrors toMessage()/toParticipant() in the other routes — the
// snake_case leak has bitten us before (see members.ts), so we map explicitly.
function toMention(r: MentionRow): Mention {
  return {
    id: r.id,
    messageId: r.message_id,
    participantId: r.participant_id,
    authorId: r.author_id,
    authorName: r.author_name,
    content: r.content,
    messageCreatedAt: r.message_created_at,
    readAt: r.read_at,
    room: r.room,
  };
}

// GET /me/mentions -> the authenticated participant's UNREAD @-mentions,
// oldest first. This is the "inbox" an agent polls when it wakes up: anything
// returned here happened while it was offline (or otherwise uncaught). Read
// mentions are intentionally excluded — callers that want full history can ask
// for that later; the inbox use case is "what's new since I last looked".
me.get("/mentions", (c) => {
  const me = c.get("participant");
  const rows = getUnreadMentions(me.id);
  return c.json(rows.map(toMention));
});

// POST /me/mentions/:id/read -> mark one mention as read.
// 200 with the updated Mention on success, 404 if no such mention belongs to
// the caller, 409 if it was already read (idempotent read is a no-op error so
// callers can tell the states apart). We scope by the authenticated recipient
// so one participant cannot mark — or probe the existence of — another's
// inbox rows (mention ownership is checked via participant_id).
me.post("/mentions/:id/read", (c) => {
  const me = c.get("participant");
  const id = c.req.param("id");
  const bad = requireValidId(c, id, "mention id");
  if (bad) return bad.r;
  const row = getMentionById(id);
  // row is nullable; row?.participant_id coerces null/undefined to undefined,
  // so the !== me.id guard covers both "no row" and "wrong owner" in one check.
  if (row?.participant_id !== me.id) {
    return jsonErr(c, "mention not found", 404);
  }
  if (row.read_at !== null) {
    return jsonErr(c, "mention already read", 409);
  }
  const readAt = Date.now();
  markMentionRead(id, readAt);
  // Re-read the full joined row so the response carries author/content like
  // the list endpoint — getMentionById only had ownership fields.
  const full = getMentionFull(id);
  return c.json(full ? toMention(full) : { id, readAt }, 200);
});

// POST /me/mentions/read -> batch-mark multiple mentions read in a single
// request. Replaces the previous per-ID loop that issued one HTTP round-trip
// per mention — a visible latency regressor when the inbox grows.
//
// Body: JSON `{ ids: string[] }`. Empty array is a no-op (200, empty list).
// Returns a list of updated mentions (joined with author + content) for the IDs
// that were actually updated. Mentions that were already read or belong to
// another participant are silently skipped (no error) — the caller only cares
// that the inbox is drained. 400 if the body is not an array. 404 if the
// recipient has zero readable mention rows (early-out for abuse).
me.post("/mentions/read", async (c) => {
  const me = c.get("participant");
  const parsed = await parseJsonBody<typeof MarkMentionsReadRequest._output>(
    c,
    MarkMentionsReadRequest,
    "ids must be an array of strings",
  );
  if (!parsed.ok) return parsed.r;
  const { ids } = parsed.data;
  if (ids.length === 0) {
    return c.json([] as Mention[]);
  }
  const readAt = Date.now();
  const updated = markMentionsRead(ids, me.id, readAt);
  // Re-read the full joined rows for display parity with the single-ID route.
  const fullRows = updated
    .map((id) => getMentionFull(id))
    .filter((r): r is MentionRow => r !== undefined);
  return c.json(fullRows.map(toMention));
});