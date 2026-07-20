import { Hono } from "hono";
import { CreateRoomRequest, type Room } from "@club/shared";
import { requireAuth } from "../auth.js";
import { listRooms, ensureRoom, type RoomRow } from "../db.js";
import { requireJson } from "../lib/json-content-type.js";
import { jsonErr, parseJsonBody } from "../lib.js";

// Open-topic rooms: every authed participant (human or agent, equally) can list
// and create rooms. A room is a topic channel, NOT an access boundary — there
// is no membership/visibility concept this phase (PRD §4.1). POST is idempotent:
// posting an existing slug returns that room without error ("ensure exists"),
// matching the open model where build and enter are the same action.

export const rooms = new Hono();
rooms.use("*", requireAuth);

// snake_case db row → camelCase contract. last_activity_at is nullable for
// empty rooms (no messages yet).
function toRoom(r: RoomRow): Room {
  return {
    id: r.id,
    slug: r.slug,
    createdAt: r.created_at,
    lastActivityAt: r.last_activity_at,
  };
}

// GET /rooms — every room, general first then most-recently-active first (the
// ordering is also computed in SQL; clients may re-sort). Each room carries
// lastActivityAt (null when empty) so clients can do "unread-first,
// active-first" ordering without a second round-trip.
rooms.get("/", (c) => {
  const rows = listRooms();
  return c.json(rows.map(toRoom));
});

// POST /rooms { name } -> Room (201 if newly created, 200 if it already existed)
// Idempotent: posting an existing slug returns the existing room. `name` is the
// canonical slug, validated by CreateRoomRequest (regex ^[a-z0-9][a-z0-9-]{0,29}$).
// "general" is seeded by the migration, so posting it just returns that row.
rooms.post("/", requireJson, async (c) => {
  const parsed = await parseJsonBody<typeof CreateRoomRequest._output>(
    c,
    CreateRoomRequest,
    "bad request",
  );
  if (!parsed.ok) return parsed.r;
  const slug = parsed.data.name;
  const room = ensureRoom(slug, Date.now());
  if (room.created) {
    const r: Room = { id: room.id, slug: room.slug, createdAt: room.created_at, lastActivityAt: null };
    return c.json(r, 201);
  }
  // Room already existed — re-read via listRooms so the response carries the
  // authoritative lastActivityAt (non-null when the room already had messages).
  const full = listRooms().find((r) => r.slug === slug);
  if (!full) {
    // Slug collided between ensureRoom() and the re-read — extremely rare,
    // but avoid leaking internals; treat as server error rather than leaking
    // the newly-created room's fields.
    return jsonErr(c, "could not create room", 500);
  }
  return c.json(toRoom(full), 200);
});
