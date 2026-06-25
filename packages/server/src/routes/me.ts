import { Hono } from "hono";
import { ulid } from "ulid";
import type { Mention, ParticipantKind } from "@club/shared";
import { requireAuth } from "../auth.js";
import {
  getUnreadMentions,
  getMentionById,
  getMentionFull,
  markMentionRead,
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
    authorKind: r.author_kind as ParticipantKind,
    content: r.content,
    messageCreatedAt: r.message_created_at,
    readAt: r.read_at,
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
  const row = getMentionById(id);
  if (!row || row.participant_id !== me.id) {
    return c.json({ error: "mention not found" }, 404);
  }
  if (row.read_at !== null) {
    return c.json({ error: "mention already read" }, 409);
  }
  const readAt = Date.now();
  markMentionRead(id, readAt);
  // Re-read the full joined row so the response carries author/content like
  // the list endpoint — getMentionById only had ownership fields.
  const full = getMentionFull(id);
  return c.json(full ? toMention(full) : { id, readAt }, 200);
});