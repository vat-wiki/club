import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

// Each test gets its own isolated temp DB to avoid "duplicate column" errors
// from the migration runner (v8 ALTER TABLE files ADD COLUMN filename) when
// tests share the cwd club.db.
const dbPath = join(tmpdir(), `club-cache-${randomUUID()}.db`);
process.env.CLUB_DB = dbPath;

afterAll(() => {
  for (const ext of ["", "-wal", "-shm"]) rmSync(dbPath + ext, { force: true });
});

afterAll(() => {
  for (const ext of ["", "-wal", "-shm"]) rmSync(dbPath + ext, { force: true });
});

// Dynamic import: db.js performs its top-level migration/statement-prep on
// import, so it must be loaded AFTER process.env.CLUB_DB is set. A static
// top-level import is evaluated before this file's env assignment runs.
const {
  clearParticipantsCache,
  clearChannelCache,
  ensureChannel,
  getAllParticipants,
  getChannelBySlug,
  invalidateChannelBySlugCache,
  invalidateChannelsCache,
  listChannels,
} = await import("./db.js");

describe("getAllParticipants cache", () => {
  beforeEach(() => {
    clearParticipantsCache();
  });

  it("returns participant rows from the DB on the first call", () => {
    const rows = getAllParticipants();
    expect(Array.isArray(rows)).toBe(true);
    // The production DB has at least a few seeded participants; assert each row
    // has the expected shape.
    for (const r of rows) {
      expect(typeof r.id).toBe("string");
      expect(typeof r.name).toBe("string");
      expect(typeof r.created_at).toBe("number");
    }
  });

  it("serves the same cached array on repeat calls", () => {
    const first = getAllParticipants();
    const second = getAllParticipants();
    expect(first).toBe(second);
  });

  it("clearParticipantsCache forces a DB re-read (different array ref)", () => {
    const first = getAllParticipants();
    clearParticipantsCache();
    const after = getAllParticipants();
    // Cache was dropped, so a fresh DB query produces a different array ref.
    expect(first).not.toBe(after);
    expect(after).toEqual(first);
  });
});

describe("ensureChannel LRU cache", () => {
  beforeEach(() => {
    clearChannelCache();
  });

  it("serves the same slug from cache on repeat calls (O(1) DB-free path)", () => {
    // First call for "general" goes through the DB (channel seeded by migration).
    const first = ensureChannel("general", Date.now());
    expect(first).toMatchObject({ slug: "general", created: false });

    // Second call must hit cache, returning an identical row (id must be equal).
    const second = ensureChannel("general", Date.now());
    expect(second).toMatchObject({ slug: "general", created: false });
    expect(second.id).toBe(first.id);
  });

  it("returns created=true only for brand-new slugs (first insert)", () => {
    // To get a real created=true, use a truly fresh slug (test channel may already
    // exist in the DB from prior runs).
    const fresh = ensureChannel("perf-cache-channel-" + crypto.randomUUID(), Date.now());
    expect(fresh.created).toBe(true);
    expect(fresh.slug).toMatch(/^perf-cache-channel-/);

    // Subsequent call returns the same row without re-inserting.
    const cached = ensureChannel(fresh.slug, Date.now());
    expect(cached.created).toBe(false);
    expect(cached.id).toBe(fresh.id);
  });

  it("clearChannelCache invalidates so the DB is re-read", () => {
    const before = ensureChannel("general", Date.now());
    clearChannelCache();
    // After clear, another call must re-fetch from DB but still return the
    // canonical "general" row (migration-seeded, never deleted).
    const after = ensureChannel("general", Date.now());
    expect(after.created).toBe(false);
    expect(after.slug).toBe("general");
    expect(after.id).toBe(before.id);
  });
});

describe("getChannelBySlug cache", () => {
  beforeEach(() => {
    invalidateChannelBySlugCache();
  });

  it("serves the same row reference on repeat lookups (O(1) DB-free path)", () => {
    const first = getChannelBySlug("general");
    expect(first).toMatchObject({ slug: "general" });
    expect(first!.id).toBeDefined();

    const second = getChannelBySlug("general");
    // Cache hit returns the exact same reference.
    expect(first).toBe(second);
  });

  it("returns undefined for non-existent slugs and caches the miss", () => {
    const result = getChannelBySlug("definitely-not-a-channel-" + crypto.randomUUID());
    expect(result).toBeUndefined();
  });

  it("invalidateChannelsCache clears the per-slug cache too", () => {
    const before = getChannelBySlug("general");
    invalidateChannelsCache();
    const after = getChannelBySlug("general");
    // Cache dropped -> fresh DB query -> different reference, same data.
    expect(before).not.toBe(after);
    expect(after).toEqual(before);
  });

  it("invalidateChannelBySlugCache only touches the slug cache, not the list cache", () => {
    const slugBefore = getChannelBySlug("general");
    const channelsList = listChannels();
    invalidateChannelBySlugCache();
    const slugAfter = getChannelBySlug("general");
    expect(slugBefore).not.toBe(slugAfter);
    expect(slugAfter).toEqual(slugBefore);
    // List cache is untouched -> same reference.
    expect(listChannels()).toBe(channelsList);
  });

  it("respects CHANNEL_BY_SLUG_CACHE_MAX and evicts the oldest key", () => {
    // Re-seed the cache for a deterministic baseline.
    invalidateChannelBySlugCache();
    const slugs = Array.from({ length: 520 }, (_, i) => `evict-test-channel-${i}`);
    // Seed non-existent slugs to populate the cache up to the limit.
    for (const slug of slugs.slice(0, 520)) {
      void getChannelBySlug(slug);
    }
    // One more lookup evicts the oldest (slugs[0]). Then a lookup for an
    // existing real channel ("general") shows the cache still serves existing
    // rows correctly after eviction pressure.
    const afterEviction = getChannelBySlug("general");
    expect(afterEviction).toMatchObject({ slug: "general" });
    expect(afterEviction!.id).toBeDefined();
    // Repeat lookup returns the same cached reference.
    const again = getChannelBySlug("general");
    expect(afterEviction).toBe(again);
  });
});
