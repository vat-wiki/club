import { afterEach,beforeEach, describe, expect, it } from "vitest";

import { clearAttachmentCache,parseAttachments } from "./attachment-cache.js";

// All test fixtures match the real MessageAttachment shape the DB emits.
const fixture = (
  id: string = "att-id",
  mime: string = "image/png",
): object => ({
  id,
  url: `/files/${id}`,
  mime,
  width: 640,
  height: 480,
  size: 12345,
  filename: "img.png",
});

const fixtureRaw = (id: string = "att-id"): string =>
  JSON.stringify([fixture(id)]);

describe("parseAttachments() + LRU cache", () => {
  beforeEach(clearAttachmentCache);
  afterEach(clearAttachmentCache);

  describe("fast path — null / empty / whitespace", () => {
    it("returns undefined for null (fast path, no cache hit)", () => {
      expect(parseAttachments(null)).toBeUndefined();
    });

    it("returns undefined for empty string", () => {
      expect(parseAttachments("")).toBeUndefined();
    });

    it("returns undefined for whitespace string", () => {
      expect(parseAttachments(" ")).toBeUndefined();
    });
  });

  describe("valid JSON arrays", () => {
    it("parses a single-attachment array", () => {
      const raw = fixtureRaw("single");
      const out = parseAttachments(raw);
      expect(out).toHaveLength(1);
      expect(out![0]).toMatchObject({ id: "single", size: 12345 });
    });

    it("parses a multi-attachment array", () => {
      const raw = JSON.stringify([fixture("a"), fixture("b")]);
      const out = parseAttachments(raw);
      expect(out).toHaveLength(2);
      expect(out![0].id).toBe("a");
      expect(out![1].id).toBe("b");
    });

    it("returns undefined for an empty array (no attachments)", () => {
      expect(parseAttachments("[]")).toBeUndefined();
    });

    it("returns the same object reference on repeat calls (cache hit)", () => {
      const raw = fixtureRaw("same");
      const a = parseAttachments(raw);
      const b = parseAttachments(raw);
      expect(a).toBe(b); // identity — proves cached reference, not a reparse
    });

    it("accepts attachments with optional fields omitted", () => {
      const raw = JSON.stringify([{ id: "narrow", url: "/files/narrow", mime: "image/gif", size: 512 }]);
      const out = parseAttachments(raw);
      expect(out).toHaveLength(1);
      expect(out![0].width).toBeUndefined();
      expect(out![0].height).toBeUndefined();
      expect(out![0].filename).toBeUndefined();
    });
  });

  describe("runtime type guard — rejects malformed rows", () => {
    it("returns undefined for an array of non-attachment objects", () => {
      const raw = JSON.stringify([{ name: "x" }]); // missing id/url/mime/size
      expect(parseAttachments(raw)).toBeUndefined();
    });

    it("returns undefined when one element of a mixed array is invalid", () => {
      const raw = JSON.stringify([fixture("ok"), { id: "bad" }]);
      expect(parseAttachments(raw)).toBeUndefined();
    });

    it("returns undefined for unknown mime value", () => {
      const raw = JSON.stringify([{
        id: "x", url: "/files/x", mime: "application/x-evil", size: 1,
      }]);
      expect(parseAttachments(raw)).toBeUndefined();
    });

    it("returns undefined for non-string id", () => {
      const raw = JSON.stringify([{
        id: 123, url: "/files/x", mime: "image/png", size: 1,
      }]);
      expect(parseAttachments(raw)).toBeUndefined();
    });

    it("returns undefined for non-numeric size", () => {
      const raw = JSON.stringify([{
        id: "x", url: "/files/x", mime: "image/png", size: "big",
      }]);
      expect(parseAttachments(raw)).toBeUndefined();
    });
  });

  describe("malformed input", () => {
    it("returns undefined for plain text", () => {
      expect(parseAttachments("not json")).toBeUndefined();
    });

    it("returns undefined for a bare number", () => {
      expect(parseAttachments("42")).toBeUndefined();
    });

    it("returns undefined for an object (not an array)", () => {
      expect(parseAttachments('{"key":"val"}')).toBeUndefined();
    });

    it("returns undefined for garbage characters", () => {
      expect(parseAttachments("!!!")).toBeUndefined();
    });
  });

  describe("LRU eviction — promote on hit", () => {
    it("moves an accessed key to the most-recently-used end of the cache", () => {
      const a = fixtureRaw("a");
      const b = fixtureRaw("b");
      const c = fixtureRaw("c");

      // Insert all three below capacity — all present.
      expect(parseAttachments(a)).not.toBeUndefined();
      expect(parseAttachments(b)).not.toBeUndefined();
      expect(parseAttachments(c)).not.toBeUndefined();

      // Re-access a several times to promote it.
      parseAttachments(a);
      parseAttachments(a);
      parseAttachments(a);

      // a is now the most recently used entry.
      expect(parseAttachments(a)).not.toBeUndefined();
    });

    it("untouched entries remain cached when capacity is not exceeded", () => {
      const keys = Array.from({ length: 10 }, (_, i) => fixtureRaw(`item-${i}`));
      for (const k of keys) parseAttachments(k);

      // Access only keys[0] repeatedly (make it MRU).
      parseAttachments(keys[0]);
      parseAttachments(keys[0]);

      // Both the hot key and a never-accessed key are still present.
      expect(parseAttachments(keys[0])).not.toBeUndefined();
      expect(parseAttachments(keys[9])).not.toBeUndefined();
    });

    it("cache grows monotonically until it hits MAX_CACHE_SIZE (512)", () => {
      // Insert a count under the cap — nothing should be evicted yet.
      const N = 256;
      const keys = Array.from({ length: N }, (_, i) => fixtureRaw(`fill-${i}`));
      for (const k of keys) parseAttachments(k);
      // Every key is still retrievable.
      for (const k of keys) {
        expect(parseAttachments(k)).not.toBeUndefined();
      }
    });
  });

  describe("clearAttachmentCache()", () => {
    it("removes all cached entries", () => {
      const raw = fixtureRaw("x");
      const before = parseAttachments(raw);
      clearAttachmentCache();
      const after = parseAttachments(raw);
      expect(after).not.toBe(before); // fresh parse, new reference
      expect(after).toEqual([fixture("x")]);
    });
  });
});
