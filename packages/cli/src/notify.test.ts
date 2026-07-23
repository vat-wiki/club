import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "@club/shared";

import {
  NOTIFY_SOURCE,
  pushMessage,
  severityFor,
  titleFor,
} from "./notify.js";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeMessage(over: Partial<Message> = {}): Message {
  return {
    id: "msg1",
    participantId: "p1",
    authorName: "alice",
    content: "hello world",
    createdAt: 1719700000000,
    room: "general",
    ...over,
  };
}

describe("severityFor", () => {
  it("returns warning when the message @-mentions me", () => {
    expect(severityFor(makeMessage({ content: "hey @bob check this" }), "bob")).toBe("warning");
  });

  it("returns info when the message does not @-mention me", () => {
    expect(severityFor(makeMessage({ content: "hey @alice check this" }), "bob")).toBe("info");
  });

  it("returns info when no me-name is given (ambient)", () => {
    expect(severityFor(makeMessage({ content: "hey @bob" }))).toBe("info");
  });

  it("respects the @-mention trailing word-boundary (no false mention)", () => {
    // "@bobby" is NOT an @-mention of "bob"; shared mentionMatches rule.
    expect(severityFor(makeMessage({ content: "hi @bobby" }), "bob")).toBe("info");
  });
});

describe("titleFor", () => {
  it("formats as [@room] author: content", () => {
    expect(titleFor(makeMessage({ content: "hello" }))).toBe("[@general] alice: hello");
  });

  it("truncates long content with an ellipsis at 40 chars", () => {
    const long = "x".repeat(50);
    const t = titleFor(makeMessage({ content: long }));
    // preview = first 40 chars + "…"
    expect(t.endsWith(`${"x".repeat(40)}…`)).toBe(true);
    expect(t.startsWith("[@general] alice: ")).toBe(true);
  });

  it("keeps short content intact", () => {
    expect(titleFor(makeMessage({ content: "short" }))).toBe("[@general] alice: short");
  });
});

describe("pushMessage", () => {
  it("POSTs to <url>/v1/notify with source=club and derived severity", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok", { status: 200 }),
    );
    const ok = await pushMessage(
      makeMessage({ content: "hey @bob", authorName: "alice", room: "general" }),
      { url: "http://127.0.0.1:8787" },
      { meName: "bob" },
    );
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe("http://127.0.0.1:8787/v1/notify");
    expect(init?.method).toBe("POST");
    const body = JSON.parse((init?.body as string) ?? "{}");
    expect(body.source).toBe(NOTIFY_SOURCE);
    expect(body.severity).toBe("warning"); // @-mentions bob
    expect(body.title).toContain("[@general]");
    expect(body.message).toContain("alice");
  });

  it("honors an explicit severity override over derived", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok", { status: 200 }),
    );
    await pushMessage(
      makeMessage({ content: "hey @bob" }),
      { url: "http://127.0.0.1:8787" },
      { meName: "bob", severity: "info" },
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1]!.body as string) ?? "{}");
    expect(body.severity).toBe("info"); // explicit wins
  });

  it("attaches the X-Notify-Secret header when a secret is provided", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok", { status: 200 }),
    );
    await pushMessage(makeMessage(), { url: "http://127.0.0.1:8787", secret: "s3cret" });
    const headers = new Headers(fetchMock.mock.calls[0]![1]!.headers);
    expect(headers.get("x-notify-secret")).toBe("s3cret");
  });

  it("returns false (not throws) on a network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const ok = await pushMessage(makeMessage(), { url: "http://127.0.0.1:8787" });
    expect(ok).toBe(false);
  });

  it("returns false on a non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 500 }),
    );
    const ok = await pushMessage(makeMessage(), { url: "http://127.0.0.1:8787" });
    expect(ok).toBe(false);
  });
});
