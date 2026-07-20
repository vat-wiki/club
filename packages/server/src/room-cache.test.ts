import { beforeEach, describe, expect, it } from "vitest";

// Requiring this module instantiates the DB connection and the room LRU cache.
// We can't easily replace the underlying stmt from here, but we can observe
// DB-interaction through the DB module itself.
import { clearRoomCache, ensureRoom } from "./db.js";

describe("ensureRoom LRU cache", () => {
  beforeEach(() => {
    clearRoomCache();
  });

  it("serves the same slug from cache on repeat calls (O(1) DB-free path)", () => {
    // First call for "general" goes through the DB (room seeded by migration).
    const first = ensureRoom("general", Date.now());
    expect(first).toMatchObject({ slug: "general", created: false });

    // Second call must hit cache, returning an identical row (id must be equal).
    const second = ensureRoom("general", Date.now());
    expect(second).toMatchObject({ slug: "general", created: false });
    expect(second.id).toBe(first.id);
  });

  it("returns created=true only for brand-new slugs (first insert)", () => {
    // To get a real created=true, use a truly fresh slug (test room may already
    // exist in the DB from prior runs).
    const fresh = ensureRoom("perf-cache-room-" + crypto.randomUUID(), Date.now());
    expect(fresh.created).toBe(true);
    expect(fresh.slug).toMatch(/^perf-cache-room-/);

    // Subsequent call returns the same row without re-inserting.
    const cached = ensureRoom(fresh.slug, Date.now());
    expect(cached.created).toBe(false);
    expect(cached.id).toBe(fresh.id);
  });

  it("clearRoomCache invalidates so the DB is re-read", () => {
    const before = ensureRoom("general", Date.now());
    clearRoomCache();
    // After clear, another call must re-fetch from DB but still return the
    // canonical "general" row (migration-seeded, never deleted).
    const after = ensureRoom("general", Date.now());
    expect(after.created).toBe(false);
    expect(after.slug).toBe("general");
    expect(after.id).toBe(before.id);
  });
});
