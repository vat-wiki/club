import type { Context } from "hono";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Participant } from "@club/shared";

import { hashKey,requireAuth } from "./auth.js";
// We need to swap the imported getParticipantByKeyHash so we can drive
// success-vs-401 cases without a real DB. The middleware re-exports hashKey
// and calls getParticipantByKeyHash internally, so we patch both the
// crypto side and the DB side via module mocks.
vi.mock("./db.js", () => ({
  getParticipantByKeyHash: vi.fn(),
}));
vi.mock("./crypto.js", () => ({
  hashKey: vi.fn(),
}));

const { getParticipantByKeyHash } = await import("./db.js");

function buildApp(handler: (c: Context) => Response | Promise<Response>) {
  const app = new Hono();
  app.use("/", requireAuth);
  app.get("/", handler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireAuth", () => {
  describe("missing Authorization header", () => {
    it("returns 401 with 'missing Authorization header'", async () => {
      const app = buildApp(() => new Response("ok", { status: 200 }));
      const res = await app.request("/");
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: "missing Authorization header",
      });
    });

    it("treats a blank header the same as missing", async () => {
      const app = buildApp(() => new Response("ok", { status: 200 }));
      const res = await app.request("/", { headers: { Authorization: "" } });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: "missing Authorization header",
      });
    });

    it("treats whitespace-only as missing", async () => {
      const app = buildApp(() => new Response("ok", { status: 200 }));
      const res = await app.request("/", { headers: { Authorization: "   " } });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: "missing Authorization header",
      });
    });
  });

  describe("malformed Authorization header", () => {
    it("rejects 'Basic' scheme", async () => {
      const app = buildApp(() => new Response("ok", { status: 200 }));
      const res = await app.request("/", {
        headers: { Authorization: "Basic dXNlcjpwYXNz" },
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: "invalid Authorization format (expected 'Bearer <token>')",
      });
    });

    it("rejects bare token with no scheme", async () => {
      const app = buildApp(() => new Response("ok", { status: 200 }));
      const res = await app.request("/", {
        headers: { Authorization: "club_x" },
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: "invalid Authorization format (expected 'Bearer <token>')",
      });
    });

    it("rejects 'Bearer' with no token after it", async () => {
      const app = buildApp(() => new Response("ok", { status: 200 }));
      const res = await app.request("/", {
        headers: { Authorization: "Bearer" },
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: "invalid Authorization format (expected 'Bearer <token>')",
      });
    });

    it("rejects 'Bearer' followed only by whitespace", async () => {
      const app = buildApp(() => new Response("ok", { status: 200 }));
      const res = await app.request("/", {
        headers: { Authorization: "Bearer " },
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: "invalid Authorization format (expected 'Bearer <token>')",
      });
    });
  });

  describe("invalid key", () => {
    it("returns 401 'invalid key' when DB lookup misses", async () => {
      vi.mocked(getParticipantByKeyHash).mockReturnValue(undefined);
      const app = buildApp(() => new Response("ok", { status: 200 }));
      const res = await app.request("/", {
        headers: { Authorization: "Bearer club_bad" },
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "invalid key" });
      expect(getParticipantByKeyHash).toHaveBeenCalledTimes(1);
    });

    it("calls hashKey before the DB lookup", async () => {
      vi.mocked(hashKey).mockReturnValue("fake_hash");
      vi.mocked(getParticipantByKeyHash).mockReturnValue(undefined);
      const app = buildApp(() => new Response("ok", { status: 200 }));
      await app.request("/", { headers: { Authorization: "Bearer club_x" } });
      expect(hashKey).toHaveBeenCalledWith("club_x");
      expect(getParticipantByKeyHash).toHaveBeenCalledWith("fake_hash");
    });
  });

  describe("valid key", () => {
    it("forwards the request and sets c.get('participant')", async () => {
      const mockRow = { id: "u1", name: "alice", created_at: "2026-01-01" };
      vi.mocked(hashKey).mockReturnValue("h1");
      vi.mocked(getParticipantByKeyHash).mockReturnValue(mockRow as unknown as import("./db.js").ParticipantRow);

      let capturedParticipant: Participant | undefined;
      const app = buildApp((c: Context) => {
        capturedParticipant = c.get("participant");
        return new Response("ok", { status: 200 });
      });

      const res = await app.request("/", {
        headers: { Authorization: "Bearer club_secret" },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
      expect(capturedParticipant).toEqual({
        id: "u1",
        name: "alice",
        createdAt: "2026-01-01",
      });
    });
  });
});
