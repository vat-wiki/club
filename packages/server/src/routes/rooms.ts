import { Hono } from 'hono';

import { CreateRoomRequest, type Room } from '@club/shared';

import { requireAuth } from '../auth.js';
import { ensureRoom, getRoomBySlug, invalidateRoomsCache, listRooms, type RoomRow } from '../db.js';
import { jsonErr, parseJsonBody } from '../lib.js';
import { requireJson } from '../lib/json-content-type.js';

/**
 * @module rooms
 * Rooms are the topic channels of the chat protocol. Every authenticated
 * participant (human or agent) can list and create rooms; rooms are not
 * access boundaries at this stage of the PRD (§4.1).
 *
 * POST is idempotent: posting an existing slug returns that room without
 * error, so "build and enter" are the same action. The slug is validated
 * by `CreateRoomRequest` and must match `^[a-z0-9][a-z0-9-]{0,29}$`.
 *
 * @see requireAuth — guards every route in this module.
 */

// Open-topic rooms: every authed participant (human or agent, equally) can list
// and create rooms. A room is a topic channel, NOT an access boundary — there
// is no membership/visibility concept this phase (PRD §4.1). POST is idempotent:
// posting an existing slug returns that room without error ("ensure exists"),
// matching the open model where build and enter are the same action.

export const rooms = new Hono();
rooms.use('*', requireAuth);

/**
 * Convert a snake_case SQLite row into the camelCase `Room` contract.
 *
 * Every route handler that touches rooms must go through this converter;
 * doing so guarantees the API always reflects the shared `Room` shape
 * even as the underlying schema evolves. `lastActivityAt` is `null` for
 * empty rooms (no messages yet), which is valid per the contract.
 */
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
rooms.get('/', (c) => {
  const rows = listRooms();
  return c.json(rows.map(toRoom));
});

/**
 * POST /rooms { name } -> Room (201 if newly created, 200 if it already existed)
 *
 * Idempotent: posting an existing slug returns the existing room. `name` is the
 * canonical slug, validated by CreateRoomRequest (regex ^[a-z0-9][a-z0-9-]{0,29}$).
 * "general" is seeded by the migration, so posting it just returns that row.
 */
rooms.post('/', requireJson, async (c) => {
  const parsed = await parseJsonBody(
    c,
    CreateRoomRequest,
    'bad request'
  );
  if (!parsed.ok) return parsed.r;
  const slug = parsed.data.name;
  const ensureResult = ensureRoom(slug, Date.now());
  if (ensureResult.created) {
    // Consistent with GET /rooms: newly-created rooms are empty, so their
    // lastActivityAt is null (per the Room contract). Route through toRoom()
    // instead of re-mapping fields inline — a single conversion site means
    // the API shape stays in sync with the shared Room type as the schema
    // evolves (matching the module-level guarantee). Invalidate the rooms list
    // cache so the next GET /rooms includes this newly-created room rather than
    // the stale pre-create snapshot.
    invalidateRoomsCache();
    const newRow: RoomRow = {
      id: ensureResult.id,
      slug: ensureResult.slug,
      created_at: ensureResult.created_at,
      last_activity_at: null,
    };
    return c.json(toRoom(newRow), 201);
  }
  // Room already existed — read back its authoritative lastActivityAt so the
  // response reflects the current state rather than a null placeholder.
  const existing = getRoomBySlug(slug);
  if (!existing) {
    // Pathologically unreachable: ensureRoom would have just created the row
    // if it were truly missing. Fail closed rather than leaking undefined.
    return jsonErr(c, 'room not found', 500);
  }
  return c.json(toRoom(existing), 200);
});
