import { Hono } from 'hono';

import { type Channel,CreateChannelRequest } from '@club/shared';

import { requireAuth } from '../auth.js';
import { type ChannelRow,ensureChannel, getChannelBySlug, invalidateChannelsCache, listChannels } from '../db.js';
import { jsonErr, parseJsonBody } from '../lib.js';
import { requireJson } from '../lib/json-content-type.js';

/**
 * @module channels
 * Channels are the topic channels of the chat protocol. Every authenticated
 * participant (human or agent) can list and create channels; channels are not
 * access boundaries at this stage of the PRD (§4.1).
 *
 * POST is idempotent: posting an existing slug returns that channel without
 * error, so "build and enter" are the same action. The slug is validated
 * by `CreateChannelRequest` and must match `^[a-z0-9][a-z0-9-]{0,29}$`.
 *
 * @see requireAuth — guards every route in this module.
 */

// Open-topic channels: every authed participant (human or agent, equally) can list
// and create channels. A channel is a topic channel, NOT an access boundary — there
// is no membership/visibility concept this phase (PRD §4.1). POST is idempotent:
// posting an existing slug returns that channel without error ("ensure exists"),
// matching the open model where build and enter are the same action.

export const channels = new Hono();
channels.use('*', requireAuth);

/**
 * Convert a snake_case SQLite row into the camelCase `Channel` contract.
 *
 * Every route handler that touches channels must go through this converter;
 * doing so guarantees the API always reflects the shared `Channel` shape
 * even as the underlying schema evolves. `lastActivityAt` is `null` for
 * empty channels (no messages yet), which is valid per the contract.
 */
function toChannel(r: ChannelRow): Channel {
  return {
    id: r.id,
    slug: r.slug,
    createdAt: r.created_at,
    lastActivityAt: r.last_activity_at,
  };
}

// GET /channels — every channel, general first then most-recently-active first (the
// ordering is also computed in SQL; clients may re-sort). Each channel carries
// lastActivityAt (null when empty) so clients can do "unread-first,
// active-first" ordering without a second round-trip.
channels.get('/', (c) => {
  const rows = listChannels();
  return c.json(rows.map(toChannel));
});

/**
 * POST /channels { name } -> Channel (201 if newly created, 200 if it already existed)
 *
 * Idempotent: posting an existing slug returns the existing channel. `name` is the
 * canonical slug, validated by CreateChannelRequest (regex ^[a-z0-9][a-z0-9-]{0,29}$).
 * "general" is seeded by the migration, so posting it just returns that row.
 */
channels.post('/', requireJson, async (c) => {
  const parsed = await parseJsonBody(
    c,
    CreateChannelRequest,
    'bad request'
  );
  if (!parsed.ok) return parsed.r;
  const slug = parsed.data.name;
  const ensureResult = ensureChannel(slug, Date.now());
  if (ensureResult.created) {
    // Consistent with GET /channels: newly-created channels are empty, so their
    // lastActivityAt is null (per the Channel contract). Route through toChannel()
    // instead of re-mapping fields inline — a single conversion site means
    // the API shape stays in sync with the shared Channel type as the schema
    // evolves (matching the module-level guarantee). Invalidate the channels list
    // cache so the next GET /channels includes this newly-created channel rather than
    // the stale pre-create snapshot.
    invalidateChannelsCache();
    const newRow: ChannelRow = {
      id: ensureResult.id,
      slug: ensureResult.slug,
      created_at: ensureResult.created_at,
      last_activity_at: null,
    };
    return c.json(toChannel(newRow), 201);
  }
  // Channel already existed — read back its authoritative lastActivityAt so the
  // response reflects the current state rather than a null placeholder.
  const existing = getChannelBySlug(slug);
  if (!existing) {
    // Pathologically unreachable: ensureChannel would have just created the row
    // if it were truly missing. Fail closed rather than leaking undefined.
    return jsonErr(c, 'channel not found', 500);
  }
  return c.json(toChannel(existing), 200);
});
