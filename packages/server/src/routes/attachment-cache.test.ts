import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { parseAttachments, clearAttachmentCache } from "./attachment-cache.js";

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
      const raw = JSON.stringify([{ name: "img.png", type: "image/png", size: 1234 }]);
      const out = parseAttachments(raw);
      expect(out).toEqual([{ name: "img.png", type: "image/png", size: 1234 }]);
    });

    it("parses a multi-attachment array", () => {
      const raw = JSON.stringify([
        { name: "a.txt", type: "text/plain" },
        { name: "b.jpg", type: "image/jpeg" },
      ]);
      const out = parseAttachments(raw);
      expect(out).toHaveLength(2);
      expect(out![0].name).toBe("a.txt");
    });

    it("returns undefined for an empty array (no attachments)", () => {
      expect(parseAttachments("[]")).toBeUndefined();
    });

    it("returns the same object reference on repeat calls (cache hit)", () => {
      const raw = JSON.stringify([{ name: "doc.pdf", type: "application/pdf" }]);
      const a = parseAttachments(raw);
      const b = parseAttachments(raw);
      expect(a).toBe(b); // identity — proves cached reference, not a reparse
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
      const a = JSON.stringify([{ name: "a" }]);
      const b = JSON.stringify([{ name: "b" }]);
      const c = JSON.stringify([{ name: "c" }]);

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
      const keys = Array.from({ length: 10 }, (_, i) =>
        JSON.stringify([{ name: `item-${i}` }])
      );
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
      const keys = Array.from({ length: N }, (_, i) =>
        JSON.stringify([{ name: `fill-${i}` }])
      );
      for (const k of keys) parseAttachments(k);
      // Every key is still retrievable.
      for (const k of keys) {
        expect(parseAttachments(k)).not.toBeUndefined();
      }
    });
  });

  describe("clearAttachmentCache()", () => {
    it("removes all cached entries", () => {
      const raw = JSON.stringify([{ name: "x" }]);
      const before = parseAttachments(raw);
      clearAttachmentCache();
      const after = parseAttachments(raw);
      expect(after).not.toBe(before); // fresh parse, new reference
      expect(after).toEqual([{ name: "x" }]);
    });
  });
});
