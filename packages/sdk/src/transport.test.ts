import { afterEach, describe, expect, it, vi } from "vitest";
import { ClubApiError, computeBackoff, shouldRetry } from "@club/shared";
import {
  getMe,
  listMessages,
  sendMessage,
  uploadFile,
  createParticipant,
  searchMessages,
  getFile,
  listMentions,
  markMentionRead,
  recoverParticipant,
  reportAgentThinking,
  reportAgentIdle,
  listRooms,
  createRoom,
  deleteMessage,
  toggleMessageReaction,
} from "./transport.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("shouldRetry", () => {
  it("retries only idempotent GETs on transient statuses", () => {
    expect(shouldRetry("GET", 500)).toBe(true);
    expect(shouldRetry("GET", 503)).toBe(true);
    expect(shouldRetry("GET", 429)).toBe(true);
    expect(shouldRetry("GET", 400)).toBe(false);
    expect(shouldRetry("GET", 404)).toBe(false);
    expect(shouldRetry("GET", 200)).toBe(false);
    expect(shouldRetry("POST", 500)).toBe(false);
  });
});

describe("computeBackoff", () => {
  it("is exponential and capped", () => {
    expect(computeBackoff(0)).toBe(200);
    expect(computeBackoff(1)).toBe(400);
    expect(computeBackoff(2)).toBe(800);
    expect(computeBackoff(20)).toBe(2000); // capped
  });
});

describe("getMe", () => {
  it("sends bearer auth and returns the participant", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(String(url)).toBe("http://x/me");
      expect((init.headers as Record<string, string>).Authorization).toBe(
        "Bearer club_agent_xyz",
      );
      return jsonRes({ id: "1", name: "a", createdAt: 1 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const me = await getMe({ server: "http://x", key: "club_agent_xyz" });
    expect(me.name).toBe("a");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("parses server error message and status on 4xx", async () => {
    globalThis.fetch = vi.fn(async () => jsonRes({ error: "invalid key" }, 401)) as typeof fetch;
    await expect(getMe({ server: "http://x", key: "k" })).rejects.toMatchObject({
      message: "invalid key",
      status: 401,
    });
    await expect(getMe({ server: "http://x", key: "k" })).rejects.toBeInstanceOf(ClubApiError);
  });
});

describe("sendMessage", () => {
  it("posts the content body and is NOT retried on 5xx", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify({ content: "hi" }));
      return jsonRes({ error: "boom" }, 500); // retryable for GET, but POST never retries
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(sendMessage({ server: "http://x", key: "k" }, "hi")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the legacy {content} body when no attachmentIds are supplied (backward compatible)", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string)).toEqual({ content: "hi" });
      return jsonRes({ id: "m1", content: "hi" });
    });
    globalThis.fetch = fetchMock as typeof fetch;
    await sendMessage({ server: "http://x", key: "k" }, "hi");
  });

  it("includes room in the body when supplied", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string)).toEqual({
        content: "hello",
        room: "build",
      });
      return jsonRes({ id: "m1", content: "hello", room: "build" });
    });
    globalThis.fetch = fetchMock as typeof fetch;
    await sendMessage({ server: "http://x", key: "k" }, "hello", { room: "build" });
  });

  it("includes replyToId in the body when supplied", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string)).toEqual({
        content: "reply",
        replyToId: "parent-1",
      });
      return jsonRes({ id: "m2", content: "reply", replyToId: "parent-1" });
    });
    globalThis.fetch = fetchMock as typeof fetch;
    await sendMessage({ server: "http://x", key: "k" }, "reply", { replyToId: "parent-1" });
  });

  it("includes attachmentIds in the body when supplied (non-empty)", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string)).toEqual({
        content: "look",
        attachmentIds: ["a1", "a2"],
      });
      return jsonRes({ id: "m1", content: "look" });
    });
    globalThis.fetch = fetchMock as typeof fetch;
    await sendMessage({ server: "http://x", key: "k" }, "look", {
      attachmentIds: ["a1", "a2"],
    });
  });

  it("falls back to the legacy body when attachmentIds is an empty array", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string)).toEqual({ content: "hi" });
      return jsonRes({ id: "m1", content: "hi" });
    });
    globalThis.fetch = fetchMock as typeof fetch;
    await sendMessage({ server: "http://x", key: "k" }, "hi", { attachmentIds: [] });
  });
});

describe("uploadFile", () => {
  it("POSTs a multipart body to /files with the bearer header and returns the attachment", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(String(url)).toBe("http://x/files");
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer club_k");
      // A FormData body is a FormData instance (not a JSON string).
      expect(init.body).toBeInstanceOf(FormData);
      const form = init.body as FormData;
      const file = form.get("file") as Blob;
      expect(file.type).toBe("image/png");
      // The bytes round-trip intact.
      const got = Buffer.from(await file.arrayBuffer());
      expect(Array.from(got)).toEqual([1, 2, 3]);
      return jsonRes({ id: "fid", url: "/files/fid", mime: "image/png", size: 3 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const att = await uploadFile(
      { server: "http://x", key: "club_k" },
      { buffer: Buffer.from([1, 2, 3]), filename: "a.png", mime: "image/png" },
    );
    expect(att.id).toBe("fid");
    expect(att.url).toBe("/files/fid");
  });

  it("works with a Uint8Array buffer too", async () => {
    globalThis.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      const got = Buffer.from(await (form.get("file") as Blob).arrayBuffer());
      expect(Array.from(got)).toEqual([10, 20]);
      return jsonRes({ id: "u", url: "/files/u", mime: "image/jpeg", size: 2 });
    }) as typeof fetch;
    const att = await uploadFile(
      { server: "http://x" },
      { buffer: new Uint8Array([10, 20]), filename: "b.jpg", mime: "image/jpeg" },
    );
    expect(att.id).toBe("u");
  });

  it("parses the server error and rethrows as ClubApiError on 4xx", async () => {
    globalThis.fetch = vi.fn(async () => jsonRes({ error: "unsupported image type" }, 415)) as typeof fetch;
    await expect(
      uploadFile({ server: "http://x", key: "k" }, { buffer: Buffer.from([]), filename: "x", mime: "image/png" }),
    ).rejects.toMatchObject({ message: "unsupported image type", status: 415 });
  });

  it("omits the Authorization header when no key is set", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
      return jsonRes({ id: "z", url: "/files/z", mime: "image/png", size: 0 });
    });
    globalThis.fetch = fetchMock as typeof fetch;
    await uploadFile({ server: "http://x" }, { buffer: Buffer.from([]), filename: "z", mime: "image/png" });
  });
});

describe("createParticipant", () => {
  it("posts without auth and returns the minted key", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(String(url)).toBe("http://x/participants");
      expect(init.method).toBe("POST");
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
      expect(JSON.parse(init.body as string)).toEqual({ name: "bot" });
      return jsonRes(
        { key: "club_agent_t", participant: { id: "1", name: "bot", createdAt: 1 } },
        201,
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const res = await createParticipant(
      { server: "http://x" },
      { name: "bot" },
    );
    expect(res.key).toBe("club_agent_t");
    expect(res.participant.name).toBe("bot");
  });
});

describe("request retry / timeout", () => {
  it("retries idempotent GET on network error then succeeds", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new TypeError("ECONNREFUSED");
      return jsonRes([{ id: "m1" }]);
    }) as typeof fetch;

    const msgs = await listMessages({ server: "http://x", key: "k" }, { retries: 3 });
    expect(msgs).toHaveLength(1);
    expect(calls).toBe(3);
  });

  it("surfaces a timeout as ClubApiError(408)", async () => {
    globalThis.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      // Never resolves on its own; the abort controller fires after timeoutMs.
      return new Promise((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    }) as typeof fetch;

    await expect(
      getMe({ server: "http://x", key: "k" }, { timeoutMs: 30, retries: 0 }),
    ).rejects.toMatchObject({ status: 408 });
  });
});

describe("searchMessages", () => {
  it("sends GET /messages/search with q, room, and limit params", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(String(url)).toBe("http://x/messages/search?q=hello&room=build&limit=10");
      return jsonRes([{ id: "m1" }]);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const msgs = await searchMessages({ server: "http://x", key: "k" }, {
      q: "hello",
      room: "build",
      limit: 10,
    });
    expect(msgs).toHaveLength(1);
  });

  it("omits room when not provided", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(String(url)).toBe("http://x/messages/search?q=test");
      return jsonRes([]);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await searchMessages({ server: "http://x", key: "k" }, { q: "test" });
  });
});

describe("getFile", () => {
  it("fetches file bytes with auth and parses content-disposition", async () => {
    const headers = new Headers();
    headers.set("content-type", "application/pdf");
    headers.set('content-disposition', 'attachment; filename="report.pdf"');
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(4),
      headers,
    })) as typeof fetch;

    const { buffer, mime, filename } = await getFile({ server: "http://x", key: "k" }, "file123");
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(mime).toBe("application/pdf");
    expect(filename).toBe("report.pdf");
  });

  it("uses default mime when content-type header is missing", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(2),
      headers: new Headers(),
    })) as typeof fetch;

    const { mime } = await getFile({ server: "http://x" }, "file456");
    expect(mime).toBe("application/octet-stream");
  });

  it("parses error response on non-OK status", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonRes({ error: "file not found" }, 404),
    ) as typeof fetch;

    await expect(getFile({ server: "http://x", key: "k" }, "missing")).rejects.toMatchObject({
      message: "file not found",
      status: 404,
    });
  });
});

describe("listMentions", () => {
  it("GETs /me/mentions with auth", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(String(url)).toBe("http://x/me/mentions");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
      return jsonRes([{ id: "ment1" }]);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const mentions = await listMentions({ server: "http://x", key: "k" });
    expect(mentions).toHaveLength(1);
    expect(mentions[0].id).toBe("ment1");
  });
});

describe("markMentionRead", () => {
  it("POSTs to /me/mentions/:id/read", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(String(url)).toBe("http://x/me/mentions/ment1/read");
      expect(init.method).toBe("POST");
      return jsonRes({ id: "ment1", read: true });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const mention = await markMentionRead({ server: "http://x", key: "k" }, "ment1");
    expect(mention.read).toBe(true);
  });
});

describe("recoverParticipant", () => {
  it("POSTs recovery request and returns new key", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(String(url)).toBe("http://x/participants/recover");
      expect(JSON.parse(init.body as string)).toEqual({ name: "alice", recoverCode: "abc123" });
      return jsonRes(
        { key: "club_agent_new", participant: { id: "1", name: "alice", createdAt: 1 } },
        201,
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const res = await recoverParticipant({ server: "http://x" }, { name: "alice", recoverCode: "abc123" });
    expect(res.key).toBe("club_agent_new");
  });

  it("throws ClubApiError(401) on recovery failure", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonRes({ error: "invalid recovery code" }, 401),
    ) as typeof fetch;

    await expect(
      recoverParticipant({ server: "http://x" }, { name: "alice", recoverCode: "wrong" }),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("reportAgentThinking", () => {
  it("POSTs empty body to /agents/thinking", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(String(url)).toBe("http://x/agents/thinking");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({});
      return new Response(null, { status: 204 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await reportAgentThinking({ server: "http://x", key: "agent1" });
  });

  it("includes room in body when supplied", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string)).toEqual({ room: "build" });
      return new Response(null, { status: 204 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await reportAgentThinking({ server: "http://x", key: "agent1" }, { room: "build" });
  });
});

describe("reportAgentIdle", () => {
  it("POSTs to /agents/idle", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(String(url)).toBe("http://x/agents/idle");
      expect(init.method).toBe("POST");
      return new Response(null, { status: 204 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await reportAgentIdle({ server: "http://x", key: "agent1" });
  });
});

describe("listRooms", () => {
  it("GETs /rooms and returns sorted rooms", async () => {
    const fetchMock = vi.fn(async () => {
      return jsonRes([
        { slug: "general", lastActivityAt: null },
        { slug: "build", lastActivityAt: 2 },
        { slug: "deploy", lastActivityAt: 1 },
      ]);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const rooms = await listRooms({ server: "http://x", key: "k" });
    expect(rooms).toHaveLength(3);
    expect(rooms[0].slug).toBe("general");
  });
});

describe("createRoom", () => {
  it("POSTs to /rooms with name and returns room", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(String(url)).toBe("http://x/rooms");
      expect(JSON.parse(init.body as string)).toEqual({ name: "new-room" });
      return jsonRes({ slug: "new-room", lastActivityAt: null });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const room = await createRoom({ server: "http://x", key: "k" }, "new-room");
    expect(room.slug).toBe("new-room");
  });
});

describe("deleteMessage", () => {
  it("DELETEs /messages/:id", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(String(url)).toBe("http://x/messages/msg123");
      expect(init.method).toBe("DELETE");
      return new Response(null, { status: 204 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await deleteMessage({ server: "http://x", key: "k" }, "msg123");
  });

  it("throws ClubApiError(404) when message not found", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonRes({ error: "message not found" }, 404),
    ) as typeof fetch;

    await expect(deleteMessage({ server: "http://x", key: "k" }, "missing")).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("toggleMessageReaction", () => {
  it("POSTs emoji to /messages/:id/reactions", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(String(url)).toBe("http://x/messages/msg1/reactions");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({ emoji: "👍" });
      return jsonRes([{ emoji: "👍", count: 1 }]);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const reactions = await toggleMessageReaction({ server: "http://x", key: "k" }, "msg1", "👍");
    expect(reactions).toEqual([{ emoji: "👍", count: 1 }]);
  });
});
