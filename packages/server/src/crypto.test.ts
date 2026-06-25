import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { hashKey } from "./crypto.js";

// hashKey is how keys are stored and verified server-side: every auth check
// hashes the presented bearer token and looks up the hash. If this function
// ever drifts (different algorithm, encoding, salting), all existing keys stop
// authenticating — so its contract is pinned here.

describe("hashKey", () => {
  it("is deterministic — the same input always yields the same hash", () => {
    expect(hashKey("club_human_abc")).toBe(hashKey("club_human_abc"));
  });

  it("produces a lowercase 64-char hex digest (sha256)", () => {
    expect(hashKey("whatever")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches node's own sha256 hex of the same input", () => {
    const input = "club_agent_xyz";
    expect(hashKey(input)).toBe(createHash("sha256").update(input).digest("hex"));
  });

  it("differs across a sample of keys (no trivial collisions)", () => {
    const keys = ["club_human_a", "club_human_b", "club_agent_a", ""];
    const hashes = new Set(keys.map(hashKey));
    expect(hashes.size).toBe(keys.length);
  });

  it("never returns the plaintext", () => {
    const key = "club_human_secret";
    expect(hashKey(key)).not.toContain(key);
  });
});
