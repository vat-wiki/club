import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@club/shared";
import { streamMessages } from "./stream.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function makeMessage(id: string, content: string): Message {
  return {
    id,
    participantId: "p",
    authorName: "n",
    authorKind: "human",
    content,
    createdAt: 1,
  };
}

const encoder = new TextEncoder();

// A controllable SSE body: push() enqueues a message frame, end() closes the
// stream (simulating a dropped connection), error() aborts it.
function sseStream() {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    push(msg: Message) {
      controller?.enqueue(encoder.encode(`data:${JSON.stringify(msg)}\n\n`));
    },
    // Push a NAMED SSE event (with an `event:` line), used to test the
    // agent_thinking / agent_idle dispatch.
    pushNamed(event: string, payload: unknown) {
      controller?.enqueue(
        encoder.encode(`event:${event}\ndata:${JSON.stringify(payload)}\n\n`),
      );
    },
    end() {
      controller?.close();
    },
    error() {
      controller?.error(new Error("aborted"));
    },
  };
}

// A fetch impl that returns `s.response` for the SSE endpoint and honors the
// abort signal by erroring the body (matching real fetch behavior), so stop()
// actually tears the connection down.
function streamFetch(s: ReturnType<typeof sseStream>): typeof fetch {
  return vi.fn(async (_url: string, init: RequestInit) => {
    init.signal?.addEventListener("abort", () => s.error());
    return s.response;
  }) as typeof fetch;
}

function jsonBody(msgs: Message[]): Response {
  return new Response(JSON.stringify(msgs), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("streamMessages", () => {
  it("delivers live messages in order", async () => {
    const s = sseStream();
    globalThis.fetch = streamFetch(s);

    const got: string[] = [];
    const handle = streamMessages(
      { server: "http://x", key: "k" },
      (m) => got.push(m.content),
      { reconnect: false },
    );

    s.push(makeMessage("01", "a"));
    s.push(makeMessage("02", "b"));

    await vi.waitFor(() => expect(got).toEqual(["a", "b"]));
    handle.stop();
  });

  it("stop() tears down the connection and halts delivery", async () => {
    const s = sseStream();
    globalThis.fetch = streamFetch(s);

    const got: string[] = [];
    const handle = streamMessages(
      { server: "http://x", key: "k" },
      (m) => got.push(m.content),
      { reconnect: false },
    );

    s.push(makeMessage("01", "a"));
    await vi.waitFor(() => expect(got).toEqual(["a"]));

    handle.stop();
    // After stop the body is errored, so this either no-ops or throws; either
    // way nothing more is delivered.
    try {
      s.push(makeMessage("02", "b"));
    } catch {
      /* controller errored by abort */
    }

    await new Promise((r) => setTimeout(r, 20));
    expect(got).toEqual(["a"]);
    expect(() => handle.stop()).not.toThrow(); // idempotent
  });

  it("reports the error and stops when reconnect is disabled", async () => {
    globalThis.fetch = vi.fn(async () => new Response("no", { status: 503 })) as typeof fetch;

    const errors: string[] = [];
    const got: string[] = [];
    const handle = streamMessages(
      { server: "http://x", key: "k" },
      (m) => got.push(m.content),
      { reconnect: false, onError: (e) => errors.push(e.message) },
    );

    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0));
    expect(got).toHaveLength(0);
    handle.stop();
  });

  it("reconnects, catches up via since=<lastId>, and de-duplicates", async () => {
    const first = sseStream();
    const second = sseStream();
    let streamCalls = 0;

    globalThis.fetch = vi.fn(async (url: string, init: RequestInit) => {
      const u = String(url);
      if (u.includes("/messages/stream")) {
        streamCalls++;
        const s = streamCalls === 1 ? first : second;
        init.signal?.addEventListener("abort", () => s.error());
        return s.response;
      }
      // Catch-up REST: claim one message (id "02") was missed during the drop.
      return jsonBody([makeMessage("02", "b")]);
    }) as typeof fetch;

    const got: string[] = [];
    const handle = streamMessages(
      { server: "http://x", key: "k" },
      (m) => got.push(m.content),
      { backoffMs: 0 }, // reconnect immediately
    );

    // Live message on the first connection, then it drops.
    first.push(makeMessage("01", "a"));
    await vi.waitFor(() => expect(got).toEqual(["a"]));
    first.end();

    // Reconnect path: catch-up delivers "b", then the second stream goes live.
    second.push(makeMessage("03", "c"));
    await vi.waitFor(() => expect(got).toEqual(["a", "b", "c"]), { timeout: 2000 });

    expect(streamCalls).toBe(2);
    handle.stop();
  });

  it("dispatches agent_thinking / agent_idle named events to their callbacks (P1-5)", async () => {
    const s = sseStream();
    globalThis.fetch = streamFetch(s);

    const thinking: string[] = [];
    const idle: string[] = [];
    const handle = streamMessages(
      { server: "http://x", key: "k" },
      () => {},
      {
        reconnect: false,
        onAgentThinking: (e) => thinking.push(e.participantId),
        onAgentIdle: (e) => idle.push(e.participantId),
      },
    );

    s.pushNamed("agent_thinking", { participantId: "p1", name: "rex", kind: "agent" });
    s.pushNamed("agent_idle", { participantId: "p1" });
    // a normal message still flows to onMessage, not to either callback
    s.push(makeMessage("01", "hi"));

    // Let the reader pump one microtask.
    await new Promise((r) => setTimeout(r, 10));

    expect(thinking).toEqual(["p1"]);
    expect(idle).toEqual(["p1"]);
    handle.stop();
  });

  it("ignores unknown named events (forward-compatible)", async () => {
    const s = sseStream();
    globalThis.fetch = streamFetch(s);

    const got: string[] = [];
    const handle = streamMessages(
      { server: "http://x", key: "k" },
      (m) => got.push(m.content),
      { reconnect: false },
    );

    // Some future event the client doesn't know about — must be dropped, not
    // mis-delivered as a message.
    s.pushNamed("future_event", { whatever: 1 });
    s.push(makeMessage("01", "real"));
    await new Promise((r) => setTimeout(r, 10));

    expect(got).toEqual(["real"]);
    handle.stop();
  });
});
