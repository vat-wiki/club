import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Message, Participant, ParticipantKind } from "@club/shared";
import {
  str,
  num,
  clampLimit,
  matchesMention,
  listenForMatch,
  dispatchTool,
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

  // Pinned explicitly: matching is a case-insensitive *substring* on "@<name>",
  // so a short mention can match a longer token. This mirrors the CLI and is a
  // deliberate trade-off (simplicity over precision); a change here must be
  // intentional and should be mirrored in the CLI's listen command.
  it("is substring-based (intentional): short mentions match longer tokens", () => {
    expect(matchesMention("ping @alicia", "al")).toBe(true); // @al inside @alicia
    expect(matchesMention("see @editorial", "ed")).toBe(true);
  });
});

function makeMsg(content: string): Message {
  return {
    id: "m_" + content,
    participantId: "p1",
    authorName: "alice",
    authorKind: "human",
    content,
    createdAt: 0,
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
function makeP(name: string, kind: ParticipantKind = "human"): Participant {
  return { id: "p_" + name, name, kind, createdAt: 0 };
}

/** A DispatchClient whose every method is overridable; defaults are inert. */
function fakeClient(over: Partial<DispatchClient> = {}): DispatchClient {
  return {
    me: async () => makeP("alice"),
    messages: async () => [],
    send: async (content: string) => makeMsg(content),
    members: async () => [],
    stream: () => ({ stop: () => {} }),
    ...over,
  };
}

describe("dispatchTool", () => {
  it("whoami formats the current participant", async () => {
    expect(await dispatchTool("whoami", {}, fakeClient())).toBe("You are alice (human). id=p_alice");
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

  it("read clamps `limit` into [1,500] and defaults `since` to '' (SDK treats '' as absent)", async () => {
    let received: { since?: string; limit: number } | null = null;
    await dispatchTool(
      "read",
      { limit: 99999 },
      fakeClient({ messages: async (opts) => { received = opts; return []; } }),
    );
    expect(received).toEqual({ since: "", limit: 500 });
  });

  it("read forwards a `since` cursor verbatim", async () => {
    let received: { since?: string; limit: number } | null = null;
    await dispatchTool(
      "read",
      { since: "m_abc" },
      fakeClient({ messages: async (opts) => { received = opts; return []; } }),
    );
    expect(received).toEqual({ since: "m_abc", limit: 50 });
  });

  it("send rejects empty / missing content without calling the client", async () => {
    const send = vi.fn(async () => makeMsg("x"));
    const client = fakeClient({ send });
    expect(await dispatchTool("send", {}, client)).toBe("error: missing content");
    expect(await dispatchTool("send", { content: "" }, client)).toBe("error: missing content");
    expect(send).not.toHaveBeenCalled();
  });

  it("send posts content and reports it back, prefixed with 'sent:'", async () => {
    const out = await dispatchTool("send", { content: "hi there" }, fakeClient());
    expect(out).toMatch(/^sent: /);
    expect(out).toContain("hi there");
  });

  it("members renders humans and agents with the right icon, one per line", async () => {
    const client = fakeClient({
      members: async () => [makeP("alice", "human"), makeP("robby", "agent")],
    });
    expect(await dispatchTool("members", {}, client)).toBe("🧑alice\n🤖robby");
  });

  it("members returns '(no members)' for an empty roster", async () => {
    expect(await dispatchTool("members", {}, fakeClient())).toBe("(no members)");
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

  it("an unknown tool name yields an 'unknown tool' error string", async () => {
    expect(await dispatchTool("frobnicate", {}, fakeClient())).toBe(
      'error: unknown tool "frobnicate"',
    );
  });

  it("propagates client errors so the handler can wrap them as 'error: <msg>'", async () => {
    const client = fakeClient({ me: async () => { throw new Error("boom"); } });
    await expect(dispatchTool("whoami", {}, client)).rejects.toThrow("boom");
  });
});
