import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach,beforeEach, describe, expect, it } from "vitest";

import { configPath, DEFAULT_ROOM,defaultRoom, loadConfig, parseConfig, saveConfig } from "./config.js";

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

  it("preserves an optional room field when present", () => {
    const raw = JSON.stringify({
      server: "http://localhost:6200",
      key: "club_human_abc",
      room: "deploy-debug",
    });
    expect(parseConfig(raw)).toEqual({
      server: "http://localhost:6200",
      key: "club_human_abc",
      room: "deploy-debug",
    });
  });

  it("accepts an empty room string without invalidating the config (room is a preference)", () => {
    const raw = JSON.stringify({ server: "http://x", key: "club_x", room: "" });
    // An empty room must NOT lock a logged-in user out; defaultRoom() handles
    // the fallback to general downstream.
    expect(parseConfig(raw)).toEqual({ server: "http://x", key: "club_x", room: "" });
  });
});

describe("defaultRoom", () => {
  it("returns the config's room when set", () => {
    expect(defaultRoom({ server: "http://x", key: "k", room: "internal" })).toBe("internal");
  });

  it("falls back to general when the config has no room", () => {
    expect(defaultRoom({ server: "http://x", key: "k" })).toBe(DEFAULT_ROOM);
    expect(DEFAULT_ROOM).toBe("general");
  });

  it("falls back to general when the room is empty/whitespace (robust to corrupt config)", () => {
    expect(defaultRoom({ server: "http://x", key: "k", room: "" })).toBe("general");
    expect(defaultRoom({ server: "http://x", key: "k", room: "   " })).toBe("general");
  });

  it("falls back to general when there is no config at all (not logged in)", () => {
    expect(defaultRoom(null)).toBe("general");
  });
});

describe("configPath / saveConfig / loadConfig", () => {
  const prevConfig = process.env.CLUB_CONFIG;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "club-cfg-"));
    process.env.CLUB_CONFIG = join(dir, "config.json");
  });

  afterEach(() => {
    process.env.CLUB_CONFIG = prevConfig;
    rmSync(dir, { recursive: true, force: true });
  });

  it("configPath respects CLUB_CONFIG (resolved absolute)", () => {
    expect(configPath()).toBe(join(dir, "config.json"));
  });

  it("configPath resolves a relative CLUB_CONFIG against cwd", () => {
    process.env.CLUB_CONFIG = "relative.json";
    expect(configPath()).toBe(resolve("relative.json"));
  });

  it("configPath falls back to ~/.club/config.json when CLUB_CONFIG is unset", () => {
    delete process.env.CLUB_CONFIG;
    expect(configPath()).toBe(join(homedir(), ".club", "config.json"));
  });

  it("loadConfig returns null when no config file exists", () => {
    expect(loadConfig()).toBeNull();
  });

  it("saveConfig then loadConfig round-trips a valid config", () => {
    saveConfig({ server: "http://localhost:6200", key: "club_human_abc" });
    expect(loadConfig()).toEqual({ server: "http://localhost:6200", key: "club_human_abc" });
  });

  it("saveConfig overwrites a previous config", () => {
    saveConfig({ server: "http://a", key: "club_a" });
    saveConfig({ server: "http://b", key: "club_b" });
    expect(loadConfig()).toEqual({ server: "http://b", key: "club_b" });
  });

  it("rejects a config saved with empty fields on load (validation holds end-to-end)", () => {
    // saveConfig writes whatever it's given; loadConfig re-validates via
    // parseConfig, so an empty server/key round-trips to null ("not logged in")
    // rather than a half-formed config that crashes downstream.
    saveConfig({ server: "", key: "club_x" });
    expect(loadConfig()).toBeNull();
  });
});
