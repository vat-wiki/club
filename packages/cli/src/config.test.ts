import { describe, it, expect } from "vitest";
import { parseConfig } from "./config.js";

describe("parseConfig", () => {
  it("returns the config when server and key are present", () => {
    const raw = JSON.stringify({ server: "http://localhost:6200", key: "club_human_abc" });
    expect(parseConfig(raw)).toEqual({ server: "http://localhost:6200", key: "club_human_abc" });
  });

  it("strips unknown keys", () => {
    const raw = JSON.stringify({ server: "http://x", key: "club_x", extra: 1, junk: true });
    expect(parseConfig(raw)).toEqual({ server: "http://x", key: "club_x" });
  });

  it("returns null when server is missing", () => {
    expect(parseConfig(JSON.stringify({ key: "club_x" }))).toBeNull();
  });

  it("returns null when key is missing", () => {
    expect(parseConfig(JSON.stringify({ server: "http://x" }))).toBeNull();
  });

  it("returns null when server or key is empty", () => {
    expect(parseConfig(JSON.stringify({ server: "", key: "club_x" }))).toBeNull();
    expect(parseConfig(JSON.stringify({ server: "http://x", key: "" }))).toBeNull();
  });

  it("returns null when field types are wrong", () => {
    expect(parseConfig(JSON.stringify({ server: 3000, key: "club_x" }))).toBeNull();
    expect(parseConfig(JSON.stringify({ server: "http://x", key: 42 }))).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseConfig("{ not json")).toBeNull();
    expect(parseConfig("")).toBeNull();
  });

  it("returns null for valid JSON that is not a config object", () => {
    expect(parseConfig("123")).toBeNull();
    expect(parseConfig("null")).toBeNull();
    expect(parseConfig('"hello"')).toBeNull();
    expect(parseConfig("[]")).toBeNull();
  });
});
