import { afterEach,describe, expect, it, vi } from "vitest";

import { type LoginDeps,runLogin } from "./login.js";

function makeDeps(): LoginDeps & { saved: { server: string; key: string }[] } {
  const saved: { server: string; key: string }[] = [];
  return {
    saved,
    saveConfig: (cfg: { server: string; key: string }) => saved.push(cfg),
  };
}

describe("runLogin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists server + key and prints confirmation", () => {
    const ctx = makeDeps();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    runLogin({ key: "club_secrettoken", server: "http://localhost:6200" }, ctx);
    expect(ctx.saved).toEqual([
      { server: "http://localhost:6200", key: "club_secrettoken" },
    ]);
    expect(log).toHaveBeenCalledWith("saved. server=http://localhost:6200");
    expect(log).toHaveBeenCalledWith("try: club whoami");
  });

  it("keeps a clean server url (no trailing slash in the saved config)", () => {
    const ctx = makeDeps();
    runLogin(
      { key: "club_key", server: "http://example.com" },
      ctx,
    );
    expect(ctx.saved[0]?.server).toBe("http://example.com");
  });

  it("does not mutate the input key (echoes exactly what was passed)", () => {
    const ctx = makeDeps();
    const key = "club_x";
    runLogin({ key, server: "http://localhost" }, ctx);
    expect(ctx.saved[0]?.key).toBe("club_x");
  });

  it("refuses a server URL passed as the key instead of silently storing it", () => {
    // The classic footgun: `club login https://club.example` lands the URL in
    // the <key> slot. A real key is a `club_…` token and never starts with a
    // scheme, so this is unambiguous - refuse rather than save a broken config
    // (URL-as-key + localhost server) that looks like it worked.
    const ctx = makeDeps();
    expect(() =>
      runLogin({ key: "https://club.vat.wiki/", server: "http://localhost:6200" }, ctx),
    ).toThrow(/looks like a server URL/);
    expect(ctx.saved).toHaveLength(0);
  });

  it("points the URL-as-key error at the correct login form", () => {
    const ctx = makeDeps();
    expect(() =>
      runLogin({ key: "https://club.vat.wiki/", server: "http://localhost:6200" }, ctx),
    ).toThrow(/club login <key> -s https:\/\/club\.vat\.wiki/);
  });
});
