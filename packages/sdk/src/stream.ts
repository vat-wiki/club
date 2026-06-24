import type { Message } from "@club/shared";
import { type ClubConn, listMessages } from "./transport.js";

// ── SSE streaming with reconnect + catch-up ─────────────────────────

export interface StreamOptions {
  /** Reconnect automatically when the stream drops (default true). */
  reconnect?: boolean;
  /** Max reconnect attempts before giving up (default Infinity — keep trying). */
  maxReconnects?: number;
  /** Base backoff ms for reconnect (default 500; exponential, jittered, capped 15s). */
  backoffMs?: number;
  /** Notified on stream errors and on each reconnect attempt. */
  onError?: (err: Error) => void;
}

export interface StreamHandle {
  /** Stop the stream and tear down the current connection. Idempotent. */
  stop: () => void;
}

const RECONNECT_CAP_MS = 15_000;

function reconnectDelay(attempt: number, base: number): number {
  const exp = Math.min(RECONNECT_CAP_MS, base * 2 ** attempt);
  return exp * (0.5 + Math.random() * 0.5); // full jitter
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

// Subscribe to /messages/stream. onMessage fires for each event. The stream
// reconnects on drop and catches up on anything missed while disconnected
// (fetched via GET /messages?since=<lastId>), de-duplicating by message id so
// overlap between the live buffer and the catch-up query is delivered exactly
// once. Returns a stop() handle.
export function streamMessages(
  c: ClubConn,
  onMessage: (m: Message) => void,
  opts: StreamOptions = {},
): StreamHandle {
  const reconnect = opts.reconnect ?? true;
  const maxReconnects = opts.maxReconnects ?? Infinity;
  const base = opts.backoffMs ?? 500;

  // One abort signal for the whole subscription lifetime; stop() aborts it,
  // which cuts the reconnect backoff short and tears down the live fetch.
  const stopSignal = new AbortController();
  let fetchController: AbortController | null = null;
  // Highest message id seen. ulid ids are lexicographically monotonic, so this
  // doubles as a "resume cursor" for catch-up and a de-dup bound.
  let lastId: string | undefined;

  void loop();

  async function loop(): Promise<void> {
    let attempts = 0;
    while (!stopSignal.signal.aborted) {
      try {
        await openStream();
        attempts = 0; // healthy connection resets the backoff window
      } catch (err) {
        if (stopSignal.signal.aborted) return;
        const err2 = err instanceof Error ? err : new Error(String(err));
        if (!reconnect || attempts >= maxReconnects) {
          opts.onError?.(err2);
          return;
        }
        opts.onError?.(err2);
        await sleep(reconnectDelay(attempts, base), stopSignal.signal);
        if (stopSignal.signal.aborted) return;
        attempts++;
      }
    }
  }

  async function openStream(): Promise<void> {
    fetchController = new AbortController();
    // If stop() fires mid-connection, abort the in-flight fetch too.
    stopSignal.signal.addEventListener(
      "abort",
      () => fetchController?.abort(),
      { once: true },
    );
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (c.key) headers.Authorization = `Bearer ${c.key}`;
    const res = await fetch(`${c.server}/messages/stream`, {
      headers,
      signal: fetchController.signal,
    });
    if (!res.ok || !res.body) throw new Error(`stream failed: HTTP ${res.status}`);

    // Subscribe-first: the SSE connection is now live, so anything broadcast
    // during catch-up lands in its buffer. Catch up on the gap (if any); the
    // id-based de-dup in deliver() collapses any overlap to exactly-once.
    await catchUp();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (!stopSignal.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const raw = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const dataLines = raw
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart());
        if (dataLines.length === 0) continue; // heartbeat/empty
        const payload = dataLines.join("\n");
        if (payload === "") continue;
        try {
          deliver(JSON.parse(payload) as Message);
        } catch {
          /* ignore malformed */
        }
      }
    }
    if (!stopSignal.signal.aborted) throw new Error("stream ended");
  }

  function deliver(m: Message): void {
    // De-dup: skip anything at or before the resume cursor (catch-up overlap).
    if (lastId !== undefined && m.id <= lastId) return;
    lastId = m.id;
    onMessage(m);
  }

  async function catchUp(): Promise<void> {
    if (lastId === undefined) return; // nothing to resume from
    try {
      const missed = await listMessages(c, { since: lastId });
      for (const m of missed) deliver(m);
    } catch {
      /* best-effort; the reopened stream keeps delivering live messages */
    }
  }

  return {
    stop: () => {
      stopSignal.abort();
      fetchController?.abort();
    },
  };
}
