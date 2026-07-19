import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Message, Participant, Room } from "@club/shared";
import {
  str,
  num,
  clampLimit,
  resolveRoom,
  matchesMention,
  listenForMatch,
  dispatchTool,
  strArray,
  __test,
  type DispatchClient,
} from "./helpers.js";

describe("str", () => {
  it("returns a real string unchanged", () => {
    expect(str("hello")).toBe("hello");
    expect(str("")).toBe("");
  });

  it("returns empty string for anything that is not a string", () => {
    expect(str(undefined)).toBe("");
    expect(str(null)).toBe("");
    expect(str(123)).toBe("");
    expect(str({})).toBe("");
    expect(str(["x"])).toBe("");
  });
});

describe("num", () => {
  it("returns the number when given a number", () => {
    expect(num(42)).toBe(42);
    expect(num(0)).toBe(0);
    expect(num(-1.5)).toBe(-1.5);
  });

  it("returns undefined for non-numbers", () => {
    expect(num(undefined)).toBeUndefined();
    expect(num(null)).toBeUndefined();
    expect(num("42")).toBeUndefined();
    expect(num("not a number")).toBeUndefined();
  });

  // Pinned explicitly: num() does NOT filter NaN/Infinity — call sites rely on
  // `??` (which only catches null/undefined), so non-finite values flow through.
  it("passes NaN and Infinity through unchanged (legacy behavior)", () => {
    expect(num(NaN)).toBeNaN();
    expect(num(Infinity)).toBe(Infinity);
    expect(num(-Infinity)).toBe(-Infinity);
  });
});

describe("strArray", () => {
  it("returns [] for absent / non-string / non-array input", () => {
    expect(strArray(undefined)).toEqual([]);
    expect(strArray(null)).toEqual([]);
    expect(strArray(42)).toEqual([]);
    expect(strArray({})).toEqual([]);
  });

  it("wraps a bare string into a one-element array (dropping empty strings)", () => {
    expect(strArray("a.png")).toEqual(["a.png"]);
    expect(strArray("  ")).toEqual([]);
  });

  it("filters an array down to just its string elements", () => {
    expect(strArray(["a.png", "b.jpg"])).toEqual(["a.png", "b.jpg"]);
    expect(strArray(["a.png", 7, null, "b.jpg"])).toEqual(["a.png", "b.jpg"]);
  });
});

describe("clampLimit", () => {
  it("defaults to 50 for non-numbers", () => {
    expect(clampLimit(undefined)).toBe(50);
    expect(clampLimit(null)).toBe(50);
    expect(clampLimit("100")).toBe(50);
    expect(clampLimit({})).toBe(50);
  });

  it("defaults to 50 for non-finite numbers (hardened)", () => {
    expect(clampLimit(NaN)).toBe(50);
    expect(clampLimit(Infinity)).toBe(50);
    expect(clampLimit(-Infinity)).toBe(50);
  });

  it("clamps values below 1 up to 1", () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(0.4)).toBe(1);
  });

  it("clamps values above 500 down to 500", () => {
    expect(clampLimit(501)).toBe(500);
    expect(clampLimit(99999)).toBe(500);
  });

  it("floors fractional values within range", () => {
    expect(clampLimit(10.9)).toBe(10);
    expect(clampLimit(1.5)).toBe(1);
    expect(clampLimit(499.99)).toBe(499);
  });

  it("keeps valid integers within range unchanged", () => {
    expect(clampLimit(1)).toBe(1);
    expect(clampLimit(50)).toBe(50);
    expect(clampLimit(250)).toBe(250);
    expect(clampLimit(500)).toBe(500);
  });
});

describe("resolveRoom", () => {
  it("returns the explicit room when it is a non-empty string", () => {
    expect(resolveRoom("deploy-debug")).toBe("deploy-debug");
    expect(resolveRoom("deploy-debug", "internal")).toBe("deploy-debug");
  });

  it("trims whitespace from an explicit room", () => {
    expect(resolveRoom("  deploy-debug  ")).toBe("deploy-debug");
  });

  it("falls back to the env room when the explicit arg is absent/empty", () => {
    expect(resolveRoom(undefined, "internal")).toBe("internal");
    expect(resolveRoom("", "internal")).toBe("internal");
    expect(resolveRoom("   ", "internal")).toBe("internal");
  });

  it("falls back to general when both explicit and env are absent/empty", () => {
    expect(resolveRoom(undefined)).toBe("general");
    expect(resolveRoom(undefined, "")).toBe("general");
    expect(resolveRoom(undefined, "   ")).toBe("general");
    expect(resolveRoom(null, undefined)).toBe("general");
  });

  it("ignores a non-string explicit arg (e.g. an LLM sending a number)", () => {
    expect(resolveRoom(42, "internal")).toBe("internal");
    expect(resolveRoom({}, undefined)).toBe("general");
  });
});

describe("matchesMention", () => {
  it("matches every message when mention is absent/empty (no-filter path)", () => {
    expect(matchesMention("anything", undefined)).toBe(true);
    expect(matchesMention("anything", null)).toBe(true);
    expect(matchesMention("anything", "")).toBe(true);
    expect(matchesMention("", undefined)).toBe(true);
  });

  it("matches a literal @mention", () => {
    expect(matchesMention("hey @alice", "alice")).toBe(true);
    expect(matchesMention("@alice please review", "alice")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(matchesMention("hey @Alice", "alice")).toBe(true);
    expect(matchesMention("hey @alice", "ALICE")).toBe(true);
    expect(matchesMention("HEY @AlIcE", "alice")).toBe(true);
  });

  it("requires the @ prefix — a bare name does not count as a mention", () => {
    expect(matchesMention("alice will handle it", "alice")).toBe(false);
    expect(matchesMention("talk to alice", "alice")).toBe(false);
  });

  it("does not match a different name", () => {
    expect(matchesMention("hey @alice", "bob")).toBe(false);
    expect(matchesMention("anyone there?", "alice")).toBe(false);
  });

  // Word boundary: a short mention must NOT match a longer @-tag. The rule is
  // shared with the CLI and the server inbox via @club/shared mentionMatches.
  it("respects word boundaries: short mentions do not match longer tokens", () => {
    expect(matchesMention("ping @alicia", "al")).toBe(false); // @al inside @alicia
    expect(matchesMention("see @editorial", "ed")).toBe(false);
    // CJK prefix collision: 走查-体验 is a prefix of 走查-体验2.
    expect(matchesMention("@走查-体验2 看下", "走查-体验")).toBe(false);
    expect(matchesMention("@走查-体验2 看下", "走查-体验2")).toBe(true);
  });
});

function makeMsg(content: string, attachments?: Message["attachments"], room = "general"): Message {
  return {
    id: "m_" + content,
    participantId: "p1",
    authorName: "alice",
    content,
    createdAt: 0,
    room,
    ...(attachments ? { attachments } : {}),
  };
}

describe("listenForMatch", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves with the first message when no mention filter is set", async () => {
    let emit: (m: Message) => void = () => {};
    const p = listenForMatch((cb) => {
      emit = cb;
      return { stop: () => {} };
    }, undefined, 1000);
    emit(makeMsg("hello"));
    expect(await p).toEqual([makeMsg("hello")]);
  });

  it("ignores non-matching messages and resolves on the first @mention", async () => {
    let emit: (m: Message) => void = () => {};
    const p = listenForMatch((cb) => {
      emit = cb;
      return { stop: () => {} };
    }, "alice", 1000);
    emit(makeMsg("hey @bob")); // filtered out
    emit(makeMsg("yo @alice hi")); // match
    expect(await p).toEqual([makeMsg("yo @alice hi")]);
  });

  it("resolves with [] when nothing matches before the timeout", async () => {
    const p = listenForMatch(() => ({ stop: () => {} }), "nobody", 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toEqual([]);
  });

  it("stops the subscription once it resolves", async () => {
    let emit: (m: Message) => void = () => {};
    let stopped = false;
    const p = listenForMatch(
      (cb) => {
        emit = cb;
        return { stop: () => { stopped = true; } };
      },
      undefined,
      1000,
    );
    emit(makeMsg("hi"));
    await p;
    expect(stopped).toBe(true);
  });
});

// ── dispatchTool ──────────────────────────────────────────────────────
function makeP(name: string): Participant {
  return { id: "p_" + name, name, createdAt: 0 };
}

/** A DispatchClient whose every method is overridable; defaults are inert. */
function fakeClient(over: Partial<DispatchClient> = {}): DispatchClient {
  return {
    me: async () => makeP("alice"),
    messages: async () => [],
    send: async (content: string) => makeMsg(content),
    uploadImage: async () => ({ id: "att_" + Math.random().toString(36).slice(2) }),
    uploadVideo: async () => ({ id: "att_" + Math.random().toString(36).slice(2) }),
    uploadDocument: async () => ({ id: "att_" + Math.random().toString(36).slice(2) }),
    members: async () => [],
    rooms: async () => [],
    stream: () => ({ stop: () => {} }),
    reportAgentThinking: async () => {},
    ...over,
  };
}

describe("dispatchTool", () => {
  // Make every dispatch test deterministic w.r.t. the CLUB_ROOM default: save
  // and clear it, restore after. Tests that need a CLUB_ROOM set it explicitly.
  const prevClubRoom = process.env.CLUB_ROOM;
  beforeEach(() => {
    delete process.env.CLUB_ROOM;
  });
  afterEach(() => {
    process.env.CLUB_ROOM = prevClubRoom;
  });

  it("whoami formats the current participant", async () => {
    expect(await dispatchTool("whoami", {}, fakeClient())).toBe("You are alice. id=p_alice");
  });

  it("read returns '(no messages)' for an empty room", async () => {
    expect(await dispatchTool("read", {}, fakeClient())).toBe("(no messages)");
  });

  it("read joins formatted messages one per line", async () => {
    const out = await dispatchTool(
      "read",
      {},
      fakeClient({ messages: async () => [makeMsg("hello"), makeMsg("world")] }),
    );
    const lines = out.split("\n");
    expect(lines).toHaveLength(2);
    expect(out).toContain("hello");
    expect(out).toContain("world");
  });

  it("read clamps `limit` into [1,500] and defaults `since` to '' and room to general", async () => {
    let received: { since?: string; limit: number; room?: string } | null = null;
    await dispatchTool(
      "read",
      { limit: 99999 },
      fakeClient({ messages: async (opts) => { received = opts; return []; } }),
    );
    expect(received).toEqual({ since: "", limit: 500, room: "general" });
  });

  it("read forwards a `since` cursor verbatim", async () => {
    let received: { since?: string; limit: number; room?: string } | null = null;
    await dispatchTool(
      "read",
      { since: "m_abc" },
      fakeClient({ messages: async (opts) => { received = opts; return []; } }),
    );
    expect(received).toEqual({ since: "m_abc", limit: 50, room: "general" });
  });

  it("read scopes to the explicit room arg", async () => {
    let received: { since?: string; limit: number; room?: string } | null = null;
    await dispatchTool(
      "read",
      { room: "deploy-debug" },
      fakeClient({ messages: async (opts) => { received = opts; return []; } }),
    );
    expect(received?.room).toBe("deploy-debug");
  });

  it("read falls back to CLUB_ROOM when no room arg is given", async () => {
    process.env.CLUB_ROOM = "internal";
    let received: { since?: string; limit: number; room?: string } | null = null;
    await dispatchTool(
      "read",
      {},
      fakeClient({ messages: async (opts) => { received = opts; return []; } }),
    );
    expect(received?.room).toBe("internal");
  });

  it("send rejects empty / missing content without calling the client", async () => {
    const send = vi.fn(async () => makeMsg("x"));
    const client = fakeClient({ send });
    expect(await dispatchTool("send", {}, client)).toContain("error: Send failed");
    expect(await dispatchTool("send", { content: "" }, client)).toContain("error: Send failed");
    expect(send).not.toHaveBeenCalled();
  });

  it("send posts content and reports it back, prefixed with 'sent:'", async () => {
    const out = await dispatchTool("send", { content: "hi there" }, fakeClient());
    expect(out).toMatch(/^sent: /);
    expect(out).toContain("hi there");
  });

  it("send defaults the room to general when neither arg nor CLUB_ROOM is set", async () => {
    let sentRoom: string | undefined;
    const client = fakeClient({
      send: async (_c, _ids, opts) => {
        sentRoom = opts?.room;
        return makeMsg("hi");
      },
    });
    await dispatchTool("send", { content: "hi" }, client);
    expect(sentRoom).toBe("general");
  });

  it("send posts to the explicit room arg", async () => {
    let sentRoom: string | undefined;
    const client = fakeClient({
      send: async (_c, _ids, opts) => {
        sentRoom = opts?.room;
        return makeMsg("hi", undefined, "deploy-debug");
      },
    });
    await dispatchTool("send", { content: "hi", room: "deploy-debug" }, client);
    expect(sentRoom).toBe("deploy-debug");
  });

  it("send falls back to CLUB_ROOM when no room arg is given", async () => {
    process.env.CLUB_ROOM = "internal";
    let sentRoom: string | undefined;
    const client = fakeClient({
      send: async (_c, _ids, opts) => {
        sentRoom = opts?.room;
        return makeMsg("hi");
      },
    });
    await dispatchTool("send", { content: "hi" }, client);
    expect(sentRoom).toBe("internal");
  });

  it("send with images uploads each path then sends with attachmentIds", async () => {
    const uploaded: string[] = [];
    let sentIds: string[] | undefined;
    const client = fakeClient({
      uploadImage: async (p: string) => {
        const id = "att_" + p;
        uploaded.push(p);
        return { id };
      },
      send: async (_content: string, attachmentIds?: string[]) => {
        sentIds = attachmentIds;
        return makeMsg("look", [
          { id: "att_a.png", url: "/files/att_a.png", mime: "image/png", size: 10 },
          { id: "att_b.jpg", url: "/files/att_b.jpg", mime: "image/jpeg", size: 20 },
        ]);
      },
    });
    const out = await dispatchTool("send", { content: "look", images: ["a.png", "b.jpg"] }, client);
    expect(uploaded).toEqual(["a.png", "b.jpg"]);
    expect(sentIds).toEqual(["att_a.png", "att_b.jpg"]);
    // The attachments render into the formatted line (cross-client visibility).
    expect(out).toContain("[图片: /files/att_a.png]");
    expect(out).toContain("[图片: /files/att_b.jpg]");
  });

  it("send accepts a bare image (no content) — text-optional path", async () => {
    const client = fakeClient({
      uploadImage: async () => ({ id: "x" }),
      send: async (_c, _attachmentIds) =>
        makeMsg("", [{ id: "x", url: "/files/x", mime: "image/png", size: 1 }]),
    });
    const out = await dispatchTool("send", { images: ["only.png"] }, client);
    expect(out).toContain("[图片: /files/x]");
  });

  it("send uploads each video and renders a [视频] token", async () => {
    const uploaded: string[] = [];
    const sentIds: string[] = [];
    const client = fakeClient({
      uploadVideo: async (p) => {
        uploaded.push(p);
        return { id: "v_" + p };
      },
      send: async (_c, attachmentIds) => {
        sentIds.push(...(attachmentIds ?? []));
        return makeMsg("watch", [
          { id: "v_a.mp4", url: "/files/v_a.mp4", mime: "video/mp4", size: 1 },
        ]);
      },
    });
    const out = await dispatchTool("send", { content: "watch", videos: ["a.mp4"] }, client);
    expect(uploaded).toEqual(["a.mp4"]);
    expect(sentIds).toEqual(["v_a.mp4"]);
    expect(out).toContain("[视频: /files/v_a.mp4]");
  });

  it("send accepts a bare video (no content) — text-optional path", async () => {
    const client = fakeClient({
      uploadVideo: async () => ({ id: "x" }),
      send: async () =>
        makeMsg("", [{ id: "x", url: "/files/x", mime: "video/webm", size: 1 }]),
    });
    const out = await dispatchTool("send", { videos: ["only.webm"] }, client);
    expect(out).toContain("[视频: /files/x]");
  });

  it("send uploads each document and renders a [文件] token with its name", async () => {
    const uploaded: string[] = [];
    const client = fakeClient({
      uploadDocument: async (p) => {
        uploaded.push(p);
        return { id: "d_" + p };
      },
      send: async () =>
        makeMsg("see", [
          { id: "d_a.pdf", url: "/files/d_a.pdf", mime: "application/pdf", size: 1, filename: "a.pdf" },
        ]),
    });
    const out = await dispatchTool("send", { content: "see", files: ["a.pdf"] }, client);
    expect(uploaded).toEqual(["a.pdf"]);
    expect(out).toContain("[文件: a.pdf]");
  });

  it("send tolerates `images` passed as a single string", async () => {
    const client = fakeClient({
      uploadImage: async (p) => ({ id: "u_" + p }),
      send: async () => makeMsg("t"),
    });
    await dispatchTool("send", { content: "t", images: "one.png" }, client);
    // single-string images should be treated as a one-element list.
  });

  it("send fails fast on too many images without uploading any", async () => {
    const uploadImage = vi.fn(async () => ({ id: "x" }));
    const client = fakeClient({ uploadImage });
    await expect(
      dispatchTool("send", { images: Array(9).fill("a.png") }, client),
    ).rejects.toThrow(/too many attachments/);
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("send propagates an upload failure as an error", async () => {
    const client = fakeClient({
      uploadImage: async () => {
        throw new Error("not a recognized image");
      },
    });
    await expect(dispatchTool("send", { images: ["bad.png"] }, client)).rejects.toThrow(
      /not a recognized image/,
    );
  });

  it("members renders one name per line", async () => {
    const client = fakeClient({
      members: async () => [makeP("alice"), makeP("robby")],
    });
    expect(await dispatchTool("members", {}, client)).toBe("alice\nrobby");
  });

  it("members returns '(no members)' for an empty roster", async () => {
    expect(await dispatchTool("members", {}, fakeClient())).toBe("(no members)");
  });

  it("rooms lists every room, general tagged as system", async () => {
    const rooms: Room[] = [
      { id: "r1", slug: "general", createdAt: 0, lastActivityAt: 100 },
      { id: "r2", slug: "deploy-debug", createdAt: 0, lastActivityAt: 200 },
      { id: "r3", slug: "internal", createdAt: 0, lastActivityAt: null },
    ];
    const out = await dispatchTool("rooms", {}, fakeClient({ rooms: async () => rooms }));
    const lines = out.split("\n");
    expect(lines).toEqual(["#general (system)", "#deploy-debug", "#internal"]);
  });

  it("rooms returns '(no rooms)' when the list is empty", async () => {
    expect(await dispatchTool("rooms", {}, fakeClient())).toBe("(no rooms)");
  });

  it("listen returns the first matching message, formatted", async () => {
    let emit: (m: Message) => void = () => {};
    const client = fakeClient({ stream: (cb) => { emit = cb; return { stop: () => {} }; } });
    vi.useFakeTimers();
    try {
      const p = dispatchTool("listen", { mention: "alice" }, client);
      emit(makeMsg("hey @alice"));
      expect(await p).toContain("hey @alice");
    } finally {
      vi.useRealTimers();
    }
  });

  it("listen reports agent_thinking when a message matches (P1-5)", async () => {
    let emit: (m: Message) => void = () => {};
    const thinking = vi.fn(async () => {});
    const client = fakeClient({
      stream: (cb) => { emit = cb; return { stop: () => {} }; },
      reportAgentThinking: thinking,
    });
    vi.useFakeTimers();
    try {
      const p = dispatchTool("listen", { mention: "alice" }, client);
      emit(makeMsg("hey @alice"));
      await p;
      expect(thinking).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("listen does NOT report thinking on timeout (nothing matched)", async () => {
    const thinking = vi.fn(async () => {});
    const client = fakeClient({
      stream: () => ({ stop: () => {} }),
      reportAgentThinking: thinking,
    });
    vi.useFakeTimers();
    try {
      const p = dispatchTool("listen", { mention: "nobody", timeoutMs: 1000 }, client);
      await vi.advanceTimersByTimeAsync(1000);
      await p;
      expect(thinking).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("listen times out with a friendly message when nothing matches", async () => {
    const client = fakeClient({ stream: () => ({ stop: () => {} }) });
    vi.useFakeTimers();
    try {
      const p = dispatchTool("listen", { mention: "nobody", timeoutMs: 1000 }, client);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await p).toBe("(no matching messages within timeout)");
    } finally {
      vi.useRealTimers();
    }
  });

  it("listen scopes the stream to the room when room is given", async () => {
    let streamOpts: { room?: string } | undefined;
    const client = fakeClient({
      stream: (_cb, opts) => {
        streamOpts = opts;
        return { stop: () => {} };
      },
    });
    vi.useFakeTimers();
    try {
      const p = dispatchTool("listen", { mention: "nobody", room: "deploy-debug", timeoutMs: 100 }, client);
      await vi.advanceTimersByTimeAsync(100);
      await p;
      expect(streamOpts).toEqual({ room: "deploy-debug" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("listen subscribes to ALL rooms (no room filter) when room is omitted", async () => {
    let streamOpts: { room?: string } | undefined;
    const client = fakeClient({
      stream: (_cb, opts) => {
        streamOpts = opts;
        return { stop: () => {} };
      },
    });
    vi.useFakeTimers();
    try {
      const p = dispatchTool("listen", { mention: "nobody", timeoutMs: 100 }, client);
      await vi.advanceTimersByTimeAsync(100);
      await p;
      // No room filter — listen defaults to global, NOT to CLUB_ROOM.
      expect(streamOpts).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });

  it("listen does NOT fall back to CLUB_ROOM (global default is intentional)", async () => {
    process.env.CLUB_ROOM = "internal";
    let streamOpts: { room?: string } | undefined;
    const client = fakeClient({
      stream: (_cb, opts) => {
        streamOpts = opts;
        return { stop: () => {} };
      },
    });
    vi.useFakeTimers();
    try {
      const p = dispatchTool("listen", { mention: "nobody", timeoutMs: 100 }, client);
      await vi.advanceTimersByTimeAsync(100);
      await p;
      expect(streamOpts).toEqual({}); // still global despite CLUB_ROOM
    } finally {
      vi.useRealTimers();
    }
  });

  it("an unknown tool name yields an 'unknown tool' error string", async () => {
    const err = await dispatchTool("frobnicate", {}, fakeClient());
    expect(err).toContain('error: Unknown tool "frobnicate"');
    expect(err).toContain("Available tools:");
    expect(err).toContain("whoami");
  });

  describe("thinking heartbeat (TTL refresh)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      __test.stopThinkingHeartbeat();
    });
    afterEach(() => {
      __test.stopThinkingHeartbeat();
      vi.useRealTimers();
    });

    it("a matched listen re-reports thinking on a cadence shorter than the TTL", async () => {
      let emit: (m: Message) => void = () => {};
      const thinking = vi.fn(async () => {});
      const client = fakeClient({
        stream: (cb) => { emit = cb; return { stop: () => {} }; },
        reportAgentThinking: thinking,
      });
      const p = dispatchTool("listen", { mention: "alice" }, client);
      emit(makeMsg("hey @alice"));
      await p;
      // initial report fires exactly once for the matched listen ...
      expect(thinking).toHaveBeenCalledOnce();
      // ... then the heartbeat re-reports every THINKING_REFRESH_MS.
      await vi.advanceTimersByTimeAsync(__test.THINKING_REFRESH_MS);
      await vi.advanceTimersByTimeAsync(__test.THINKING_REFRESH_MS);
      expect(thinking).toHaveBeenCalledTimes(3); // 1 initial + 2 heartbeats
    });

    it("send stops the heartbeat (the server auto-clears thinking on reply)", async () => {
      let emit: (m: Message) => void = () => {};
      const thinking = vi.fn(async () => {});
      const client = fakeClient({
        stream: (cb) => { emit = cb; return { stop: () => {} }; },
        reportAgentThinking: thinking,
      });
      const lp = dispatchTool("listen", { mention: "alice" }, client);
      emit(makeMsg("hey @alice"));
      await lp;
      await vi.advanceTimersByTimeAsync(__test.THINKING_REFRESH_MS);
      expect(thinking).toHaveBeenCalledTimes(2);
      // agent replies → heartbeat must stop so we don't refresh a cleared state
      await dispatchTool("send", { content: "done" }, client);
      await vi.advanceTimersByTimeAsync(__test.THINKING_REFRESH_MS * 3);
      expect(thinking).toHaveBeenCalledTimes(2); // no further re-reports
    });
  });

  it("propagates client errors so the handler can wrap them as 'error: <msg>'", async () => {
    const client = fakeClient({ me: async () => { throw new Error("boom"); } });
    await expect(dispatchTool("whoami", {}, client)).rejects.toThrow("boom");
  });
});
