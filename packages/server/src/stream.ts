import type { SSEStreamingApi } from "hono/streaming";
import type { Message } from "@club/shared";

// Live SSE subscribers registered at connect time. The POST /messages route
// pushes new messages here; subscribers are removed on abort.
const subscribers = new Set<{
  stream: SSEStreamingApi;
  dead: boolean;
}>();

export function addSubscriber(s: SSEStreamingApi): () => void {
  const entry = { stream: s, dead: false };
  subscribers.add(entry);
  return () => {
    entry.dead = true;
    subscribers.delete(entry);
  };
}

export function broadcast(msg: Message): void {
  const payload = JSON.stringify(msg);
  for (const sub of subscribers) {
    if (sub.dead) continue;
    // writeSSE returns a promise; fire-and-forget, drop on failure.
    void sub.stream
      .writeSSE({ data: payload })
      .catch(() => {
        sub.dead = true;
        subscribers.delete(sub);
      });
  }
}

// Keep idle connections warm and surface dead ones so they get reaped.
setInterval(() => {
  for (const sub of subscribers) {
    if (sub.dead) {
      subscribers.delete(sub);
      continue;
    }
    void sub.stream
      .writeSSE({ data: "" }) // empty data line doubles as a heartbeat comment-safe ping
      .catch(() => {
        sub.dead = true;
        subscribers.delete(sub);
      });
  }
}, 15000).unref();