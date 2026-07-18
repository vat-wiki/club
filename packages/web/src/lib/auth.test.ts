import { afterEach, describe, expect, it } from "vitest";
import { loadConn, saveConn, saveRecoverCode, getRecoverCode, clearConn, getKey, API_URL } from "./auth.js";

afterEach(() => {
  localStorage.clear();
});

describe("API_URL", () => {
  it("defaults to empty string when VITE_API_URL is unset", () => {
    expect(API_URL).toBe("");
  });
});

describe("loadConn", () => {
  it("returns null when no key is stored", () => {
    expect(loadConn()).toBeNull();
  });

  it("returns ClubConn from localStorage key + server", () => {
    localStorage.setItem("club_key", "club_agent_abc");
    localStorage.setItem("club_server", "http://prod.example.com");
    const conn = loadConn();
    expect(conn).toEqual({ server: "http://prod.example.com", key: "club_agent_abc" });
  });

  it("falls back to API_URL when server is not stored", () => {
    localStorage.setItem("club_key", "club_agent_abc");
    const conn = loadConn();
    expect(conn).toEqual({ server: API_URL, key: "club_agent_abc" });
  });
});

describe("saveConn", () => {
  it("stores key and server in localStorage", () => {
    saveConn("club_agent_xyz");
    expect(localStorage.getItem("club_key")).toBe("club_agent_xyz");
    expect(localStorage.getItem("club_server")).toBe(API_URL);
  });

  it("overwrites previous key", () => {
    saveConn("old_key");
    saveConn("new_key");
    expect(localStorage.getItem("club_key")).toBe("new_key");
  });
});

describe("saveRecoverCode / getRecoverCode", () => {
  it("stores and retrieves a recovery code", () => {
    saveRecoverCode("club_recover_abc123");
    expect(getRecoverCode()).toBe("club_recover_abc123");
  });

  it("returns null when no code is stored", () => {
    expect(getRecoverCode()).toBeNull();
  });
});

describe("getKey", () => {
  it("reads the key from localStorage", () => {
    localStorage.setItem("club_key", "club_agent_key123");
    expect(getKey()).toBe("club_agent_key123");
  });

  it("returns null when no key is stored", () => {
    expect(getKey()).toBeNull();
  });
});

describe("clearConn", () => {
  it("removes all club-related localStorage entries", () => {
    localStorage.setItem("club_key", "k");
    localStorage.setItem("club_server", "http://x");
    localStorage.setItem("club_recover_code", "rc");
    clearConn();
    expect(localStorage.getItem("club_key")).toBeNull();
    expect(localStorage.getItem("club_server")).toBeNull();
    expect(localStorage.getItem("club_recover_code")).toBeNull();
  });

  it("does not affect unrelated localStorage entries", () => {
    localStorage.setItem("club_key", "k");
    localStorage.setItem("unrelated", "value");
    clearConn();
    expect(localStorage.getItem("unrelated")).toBe("value");
  });
});
