import { beforeEach, describe, expect, it, vi } from "vitest";

// Minimal mock of a real File so uploadFile tests have a usable File.
function mockFile(name = "x.png", type = "image/png", size = 100): File {
  return new File([new Uint8Array(size)], name, { type });
}

// vi.mock factories are hoisted to the top of the file (above any const /
// class declarations), so the SDK stubs must be self-contained. We use a real
// class so `new ClubClient(...)` works, and a static `_instances` array so
// tests can read back the most-recent instance.
vi.mock("@club/sdk", () => {
  const request = vi.fn().mockResolvedValue({});
  class ClubClient {
    static _instances: ClubClient[] = [];
    me = vi.fn().mockResolvedValue({ id: "a1", name: "alice" });
    messages = vi.fn().mockResolvedValue([{}]);
    send = vi.fn().mockResolvedValue({});
    members = vi.fn().mockResolvedValue([{ id: "a1", name: "alice" }]);
    rooms = vi.fn().mockResolvedValue([{ id: "general", name: "general", participants: [] }]);
    createRoom = vi.fn().mockResolvedValue({ id: "general", name: "general", participants: [] });
    search = vi.fn().mockResolvedValue([{}]);
    reportAgentThinking = vi.fn().mockResolvedValue(undefined);
    reportAgentIdle = vi.fn().mockResolvedValue(undefined);
    createParticipant = vi.fn().mockResolvedValue({ key: "new_key", recoverCode: "rec-123" });
    constructor() {
      ClubClient._instances.push(this);
    }
  }
  return {
    request,
    ClubClient,
    ClubApiError: vi.fn((msg, status) => ({ name: "ClubApiError", msg, status })),
  };
});

vi.mock("@club/shared", () => ({
  ImageMime: { options: ["image/png", "image/jpeg", "image/gif", "image/webp"] },
  VideoMime: { options: ["video/mp4", "video/webm"] },
  DocumentMime: { options: ["application/pdf"] },
  MAX_IMAGE_BYTES: 10 * 1024 * 1024,
  MAX_VIDEO_BYTES: 50 * 1024 * 1024,
  MAX_DOCUMENT_BYTES: 10 * 1024 * 1024,
}));

vi.mock("./upload", () => ({
  uploadImage: vi.fn().mockResolvedValue({
    id: "att-1",
    name: "x.png",
    size: 100,
    type: "image/png",
  }),
}));

// Import the api facade once. Because the SDK mocks above are hoisted,
// every call to `new ClubClient(...)` in api.ts gets a stub.
import type { ClubConn } from "@club/sdk";
import * as sdk from "@club/sdk";

import { api, createParticipant, recoverParticipant } from "./api";

const conn: ClubConn = { server: "https://example.club", key: "k" };
const Client = sdk.ClubClient as any;
// Most-recent instance — api creates a new ClubClient per call.
function last(): any {
  return Client._instances.at(-1);
}

beforeEach(() => {
  vi.clearAllMocks();
  Client._instances = [];
});

describe("api facade — delegates to ClubClient", () => {
  it("me() returns participant from ClubClient.me()", async () => {
    const p = await api.me(conn);
    expect(p).toEqual({ id: "a1", name: "alice" });
  });

  it("messages() forwards since + room to ClubClient.messages()", async () => {
    await api.messages(conn, "msg-0", "dev");
    const inst = last();
    expect(inst.messages.mock.calls[0][0]).toMatchObject({
      since: "msg-0",
      room: "dev",
      limit: 50,
    });
  });

  it("members() returns participants", async () => {
    const m = await api.members(conn);
    expect(m).toEqual([{ id: "a1", name: "alice" }]);
  });

  it("rooms() returns rooms", async () => {
    const r = await api.rooms(conn);
    expect(r).toEqual([{ id: "general", name: "general", participants: [] }]);
  });

  it("createRoom() forwards name and returns Room", async () => {
    const r = await api.createRoom(conn, "dev");
    expect(r).toEqual({ id: "general", name: "general", participants: [] });
    expect(last().createRoom.mock.calls[0][0]).toBe("dev");
  });

  it("search() forwards query + optional room", async () => {
    await api.search(conn, "foo", "dev");
    expect(last().search.mock.calls[0]).toEqual(["foo", { room: "dev" }]);
  });

  it("thinking() calls reportAgentThinking", async () => {
    await api.thinking(conn, "dev");
    expect(last().reportAgentThinking).toHaveBeenCalledWith("dev");
  });

  it("idle() calls reportAgentIdle", async () => {
    await api.idle(conn, "dev");
    expect(last().reportAgentIdle).toHaveBeenCalledWith("dev");
  });
});

describe("api.send — route selection", () => {
  it("uses ClubClient.send() for plain content (unchanged path)", async () => {
    await api.send(conn, "hello");
    expect(last().send).toHaveBeenCalledWith("hello");
  });

  it("uses request POST when attachmentIds are present", async () => {
    await api.send(conn, "hello", ["att-1"]);
    const { request } = await import("@club/sdk");
    expect(request).toHaveBeenCalledWith(
      conn,
      "/messages",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          content: "hello",
          attachmentIds: ["att-1"],
          room: "general",
        }),
      }),
    );
  });

  it("includes replyToId in the body when provided", async () => {
    await api.send(conn, "re", [], "msg-0");
    const { request } = await import("@club/sdk");
    expect(request).toHaveBeenCalledWith(
      expect.anything(),
      "/messages",
      expect.objectContaining({ body: expect.objectContaining({ replyToId: "msg-0" }) }),
    );
  });

  it("includes room in the body when provided", async () => {
    await api.send(conn, "hi", [], undefined, "dev");
    const { request } = await import("@club/sdk");
    expect(request).toHaveBeenCalledWith(
      expect.anything(),
      "/messages",
      expect.objectContaining({ body: expect.objectContaining({ room: "dev" }) }),
    );
  });
});

describe("api.deleteMessage — encodes id", () => {
  it("encodes messageId and sends DELETE", async () => {
    await api.deleteMessage(conn, "msg/a+1");
    const { request } = await import("@club/sdk");
    expect(request).toHaveBeenCalledWith(
      expect.anything(),
      "/messages/msg%2Fa%2B1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("api.react — encodes messageId", () => {
  it("encodes messageId and posts emoji", async () => {
    await api.react(conn, "msg/a+1", "👍");
    const { request } = await import("@club/sdk");
    expect(request).toHaveBeenCalledWith(
      expect.anything(),
      "/messages/msg%2Fa%2B1/reactions",
      expect.objectContaining({ method: "POST", body: { emoji: "👍" } }),
    );
  });
});

describe("api.uploadFile — delegates to uploadImage", () => {
  it("passes file and opts through", async () => {
    const f = mockFile();
    const onProgress = vi.fn();
    const result = await api.uploadFile(conn, f, { timeoutMs: 5000, onProgress });
    const { uploadImage } = await import("./upload");
    expect(uploadImage).toHaveBeenCalledWith(conn, f, { timeoutMs: 5000, onProgress });
    expect(result).toEqual({
      id: "att-1",
      name: "x.png",
      size: 100,
      type: "image/png",
    });
  });
});

describe("createParticipant — returns key + recoverCode", () => {
  it("calls ClubClient.createParticipant and returns identity", async () => {
    const result = await createParticipant("https://example.club", "alice");
    expect(result).toEqual({ key: "new_key", recoverCode: "rec-123" });
    expect(last().createParticipant).toHaveBeenCalledWith({ name: "alice" });
  });
});

describe("recoverParticipant — posts recovery request", () => {
  it("calls request with empty key", async () => {
    await recoverParticipant("https://example.club", {
      name: "alice",
      recoverCode: "rec-123",
    });
    const { request } = await import("@club/sdk");
    expect(request).toHaveBeenCalledWith(
      { server: "https://example.club", key: "" },
      "/participants/recover",
      expect.objectContaining({
        method: "POST",
        body: { name: "alice", recoverCode: "rec-123" },
      }),
    );
  });
});
