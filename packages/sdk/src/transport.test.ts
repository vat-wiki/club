import { afterEach, describe, expect, it, vi } from "vitest";
import { ClubApiError } from "./errors.js";
import {
  computeBackoff,
  shouldRetry,
  getMe,
  listMessages,
  sendMessage,
  createParticipant,
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
      return jsonRes({ id: "1", name: "a", kind: "agent", createdAt: 1 });
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
});

describe("createParticipant", () => {
  it("posts without auth and returns the minted key", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(String(url)).toBe("http://x/participants");
      expect(init.method).toBe("POST");
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
      expect(JSON.parse(init.body as string)).toEqual({ name: "bot", kind: "agent" });
      return jsonRes(
        { key: "club_agent_t", participant: { id: "1", name: "bot", kind: "agent", createdAt: 1 } },
        201,
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const res = await createParticipant(
      { server: "http://x" },
      { name: "bot", kind: "agent" },
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
