import { describe, it, expect, afterAll } from "vitest";
import { filesDir, filePath } from "./files-dir.js";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

describe("files-dir", () => {
  const safeTestDir = resolve(__dirname, "..", "test-fixture", "files");
  mkdirSync(safeTestDir, { recursive: true });

  // Write a decoy file next to the fixture dir so an attacker who wins
  // path-traversal would be able to read it.
  const decoyFile = join(safeTestDir, "..", "decoy.txt");
  writeFileSync(decoyFile, "secret", "utf8");

  // Stub CLUB_FILES so filesDir() resolves to our fixture dir.
  const prevEnv = process.env.CLUB_FILES;
  process.env.CLUB_FILES = safeTestDir;

  describe("filePath path-traversal protection", () => {
    it("resolves a normal base64url-like id inside the files dir", async () => {
      const id = "abc123def456";
      const p = await filePath(id);
      expect(p).toBe(join(safeTestDir, id));
      expect(p).not.toContain("..");
    });

    it("rejects a path-traversal id containing '..'", async () => {
      const p = await filePath("../decoy.txt");
      // Must not escape the files dir.
      expect(p).not.toBe(decoyFile);
      // Resolve result must still be under the files dir (or the safe fallback
      // cwd/files, which is also not under safeTestDir — the real guard is that
      // the caller 404s because the file doesn't exist there).
      expect(existsSync(p)).toBe(false);
    });

    it("rejects a traversal id using absolute path prefix", async () => {
      const p = await filePath("/etc/passwd");
      expect(p).not.toContain("etc/passwd");
      expect(existsSync(p)).toBe(false);
    });

    it("rejects backslash path separators", async () => {
      const p = await filePath("..\\decoy.txt");
      expect(p).not.toBe(decoyFile);
    });
  });

  describe("filesDir", () => {
    it("returns the configured dir", () => {
      expect(filesDir()).toBe(safeTestDir);
    });
  });

  afterAll(() => {
    if (prevEnv === undefined) {
      delete process.env.CLUB_FILES;
    } else {
      process.env.CLUB_FILES = prevEnv;
    }
  });
});
