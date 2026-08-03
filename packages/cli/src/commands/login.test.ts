import { afterEach, describe, expect, it, vi } from "vitest";

import { ClubApiError } from "@club/sdk";

import { type LoginDeps, runLogin } from "./login.js";

const PARTICIPANT = { id: "p_1", name: "alice", bio: "" } as const;

function makeDeps(overrides: Partial<LoginDeps> = {}): LoginDeps & {
  saved: { server: string; key: string }[];
} {
  const saved: { server: string; key: string }[] = [];
  return {
    saved,
    me: overrides.me ?? (async () => PARTICIPANT),
    saveConfig: (cfg: { server: string; key: string }) => saved.push(cfg),
  };
}

describe("runLogin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("verifies the key, then persists server + key and prints the identity", async () => {
    const ctx = makeDeps();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runLogin({ key: "club_secrettoken", server: "http://localhost:6200" }, ctx);
    expect(ctx.saved).toEqual([
      { server: "http://localhost:6200", key: "club_secrettoken" },
    ]);
    expect(log).toHaveBeenCalledWith("saved. server=http://localhost:6200");
    expect(log).toHaveBeenCalledWith("logged in as alice (id=p_1)");
  });

  it("keeps a clean server url (no trailing slash in the saved config)", async () => {
    const ctx = makeDeps();
    await runLogin(
      { key: "club_key", server: "http://example.com" },
      ctx,
    );
    expect(ctx.saved[0]?.server).toBe("http://example.com");
  });

  it("does not mutate the input key (echoes exactly what was passed)", async () => {
    const ctx = makeDeps();
    const key = "club_x";
    await runLogin({ key, server: "http://localhost" }, ctx);
    expect(ctx.saved[0]?.key).toBe("club_x");
  });

  it("refuses a server URL passed as the key instead of silently storing it", async () => {
    // The classic footgun: `club login https://club.example` lands the URL in
    // the <key> slot. A real key is a `club_…` token and never starts with a
    // scheme, so this is unambiguous - refuse rather than save a broken config
    // (URL-as-key + localhost server) that looks like it worked. The guard
    // fires before any network call, so `me` is never reached.
    const me = vi.fn();
    const ctx = makeDeps({ me });
    await expect(
      runLogin({ key: "https://club.vat.wiki/", server: "http://localhost:6200" }, ctx),
    ).rejects.toThrow(/looks like a server URL/);
    expect(ctx.saved).toHaveLength(0);
    expect(me).not.toHaveBeenCalled();
  });

  it("points the URL-as-key error at the correct login form", async () => {
    const ctx = makeDeps();
    await expect(
      runLogin({ key: "https://club.vat.wiki/", server: "http://localhost:6200" }, ctx),
    ).rejects.toThrow(/club login <key> -s https:\/\/club\.vat\.wiki/);
  });

  it("does not save when the server rejects the key (401)", async () => {
    const ctx = makeDeps({
      me: async () => {
        throw new ClubApiError("invalid key", 401);
      },
    });
    await expect(
      runLogin({ key: "club_bogus", server: "https://club.example" }, ctx),
    ).rejects.toThrow(/login failed: https:\/\/club\.example rejected that key/);
    expect(ctx.saved).toHaveLength(0);
  });

  it("does not save when the server is unreachable (network failure)", async () => {
    const ctx = makeDeps({
      me: async () => {
        throw new ClubApiError("fetch failed", 0);
      },
    });
    await expect(
      runLogin({ key: "club_x", server: "https://club.example" }, ctx),
    ).rejects.toThrow(/could not reach https:\/\/club\.example/);
    expect(ctx.saved).toHaveLength(0);
  });
});
