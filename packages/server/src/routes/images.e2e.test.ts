import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll,describe, expect, it } from "vitest";

// End-to-end integration for the image pipeline: a single Hono app exercises
// the real routes against a real (temp) SQLite DB + real blob dir. This is the
// cross-cutting test the per-route files can't provide — it proves the whole
// chain agrees on attachment metadata (mime/width/height/size), that GET
// /files/:id returns byte-exact bytes with immutable cache headers, that old
// text-only clients stay compatible, and that SSE pushes attachment messages.

const dbPath = join(tmpdir(), `club-images-e2e-${randomUUID()}.db`);
process.env.CLUB_DB = dbPath;
const dir = join(tmpdir(), `club-images-e2e-blobs-${randomUUID()}`);
process.env.CLUB_FILES = dir;

const { messages } = await import("./messages.js");
const { files } = await import("./files.js");
const { participants } = await import("./participants.js");
const { Hono } = await import("hono");

const app = new Hono();
app.route("/participants", participants);
app.route("/files", files);
app.route("/messages", messages);

afterAll(() => {
  for (const ext of ["", "-wal", "-shm"]) rmSync(dbPath + ext, { force: true });
  rmSync(dir, { recursive: true, force: true });
});

// ── Helpers ───────────────────────────────────────────────────────────

async function mintKey(name: string): Promise<string> {
  const res = await app.request("/participants", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return (await res.json()).key;
}
function auth(key: string) {
  return { Authorization: `Bearer ${key}` };
}

// A real 2x3 PNG (not 1x1) so width != height and we can prove the server
// preserves each dimension independently rather than e.g. squaring them.
const PNG_2x3 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAABysg0WAAAAHklEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
// A real small JPEG for the mime/magic-byte path.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC0zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD/2Q==",
  "base64",
);

async function upload(
  key: string,
  buf: Buffer,
  filename: string,
  mime: string,
): Promise<{ status: number; body: any }> {
  const form = new FormData();
  form.append("file", new File([buf], filename, { type: mime }));
  const res = await app.request("/files", {
    method: "POST",
    headers: auth(key),
    body: form,
  });
  return { status: res.status, body: await res.json() };
}

async function postMsg(
  key: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  const res = await app.request("/messages", {
    method: "POST",
    headers: { ...auth(key), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// ── The full chain ────────────────────────────────────────────────────

describe("image pipeline: upload → send → read → GET bytes", () => {
  it("carries authoritative attachment metadata end-to-end and serves byte-exact bytes", async () => {
    const key = await mintKey("e2e1");

    // 1. Upload a 2x3 PNG. Server must report the *real* dimensions (not 1x1,
    //    not squared), the real mime, and the real byte size.
    const up = await upload(key, PNG_2x3, "a.png", "image/png");
    expect(up.status).toBe(201);
    expect(up.body.mime).toBe("image/png");
    expect(up.body.width).toBe(2);
    expect(up.body.height).toBe(3);
    expect(up.body.size).toBe(PNG_2x3.length);
    expect(up.body.url).toBe(`/files/${up.body.id}`);
    const attId = up.body.id;

    // 2. Send a message referencing the uploaded id.
    const sent = await postMsg(key, {
      content: "look at this",
      attachmentIds: [attId],
    });
    expect(sent.status).toBe(201);
    // The POST response echoes server-built attachments (not the client's).
    expect(sent.body.attachments).toEqual([
      expect.objectContaining({
        id: attId,
        url: `/files/${attId}`,
        mime: "image/png",
        width: 2,
        height: 3,
        size: PNG_2x3.length,
      }),
    ]);
    const msgId = sent.body.id;

    // 3. Read it back via GET /messages — attachments must rehydrate from the
    //    DB (not the POST echo), with identical metadata.
    const listRes = await app.request("/messages?limit=10", {
      headers: auth(key),
    });
    const list = await listRes.json();
    const mine = list.find((m: any) => m.id === msgId);
    expect(mine).toBeTruthy();
    expect(mine.attachments.length).toBe(1);
    expect(mine.attachments[0]).toEqual(
      expect.objectContaining({
        id: attId,
        url: `/files/${attId}`,
        mime: "image/png",
        width: 2,
        height: 3,
        size: PNG_2x3.length,
      }),
    );

    // 4. GET /files/:id is unauthenticated and serves byte-exact bytes with
    //    immutable cache headers (the <img src> path).
    const blobRes = await app.request(`/files/${attId}`);
    expect(blobRes.status).toBe(200);
    expect(blobRes.headers.get("content-type")).toBe("image/png");
    expect(blobRes.headers.get("content-length")).toBe(String(PNG_2x3.length));
    expect(blobRes.headers.get("cache-control")).toBe(
      "public, immutable, max-age=31536000",
    );
    const bytes = Buffer.from(await blobRes.arrayBuffer());
    expect(bytes.equals(PNG_2x3)).toBe(true);
  });

  it("preserves user-chosen order across multiple attachments end-to-end", async () => {
    const key = await mintKey("e2e2");
    const a = (await upload(key, PNG_2x3, "a.png", "image/png")).body;
    const b = (await upload(key, JPEG, "b.jpg", "image/jpeg")).body;
    const c = (await upload(key, PNG_2x3, "c.png", "image/png")).body;

    // Deliberately non-creation order: c, a, b.
    const sent = await postMsg(key, {
      content: "three",
      attachmentIds: [c.id, a.id, b.id],
    });
    expect(sent.status).toBe(201);
    expect(sent.body.attachments.map((x: any) => x.id)).toEqual([
      c.id,
      a.id,
      b.id,
    ]);

    // Order survives a GET /messages round-trip (rehydrated from DB).
    const list = await (
      await app.request("/messages?limit=10", { headers: auth(key) })
    ).json();
    const mine = list.find((m: any) => m.content === "three");
    expect(mine.attachments.map((x: any) => x.id)).toEqual([c.id, a.id, b.id]);
  });
});

// ── SSE: an attachment message is pushed to live subscribers ─────────

describe("SSE pushes attachment messages to live subscribers", () => {
  it("delivers a message with attachments over /messages/stream", async () => {
    const key = await mintKey("sse1");

    // Open the SSE stream. The route holds it open indefinitely; we read it
    // incrementally until our broadcast frame lands, then abort.
    const controller = new AbortController();
    const streamRes = await app.request("/messages/stream", {
      headers: auth(key),
      signal: controller.signal,
    });
    expect(streamRes.status).toBe(200);

    // Drive the SSE body: collect text frames until we see a JSON `data:`
    // frame whose parsed payload has our content.
    const body = streamRes.body!;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let received: any = null;

    // Broadcast a message with an attachment AFTER the subscription is open.
    // Give the route a tick to register the subscriber before we POST.
    const att = (await upload(key, PNG_2x3, "s.png", "image/png")).body;
    const sendPromise = postMsg(key, {
      content: "streamed image",
      attachmentIds: [att.id],
    });

    // Read frames with a timeout so the test can't hang if broadcast breaks.
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && received == null) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE frames are separated by blank lines; each event's data is prefixed
      // `data:`. Pull complete events out of the buffer.
      let nl: number;
      while ((nl = buf.indexOf("\n\n")) >= 0) {
        const event = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        for (const line of event.split("\n")) {
          const m = line.match(/^data:(.*)$/);
          if (!m) continue;
          const payload = m[1];
          if (!payload) continue; // heartbeat
          try {
            const obj = JSON.parse(payload);
            if (obj.content === "streamed image") {
              received = obj;
            }
          } catch {
            // ignore non-JSON frames
          }
        }
      }
    }
    controller.abort();
    try {
      await reader.cancel();
    } catch {
      /* abort may race */
    }

    const sent = await sendPromise;
    expect(sent.status).toBe(201);
    expect(received).not.toBeNull();
    expect(received.attachments.length).toBe(1);
    expect(received.attachments[0].id).toBe(att.id);
    expect(received.attachments[0].mime).toBe("image/png");
  });
});

// ── Backward compatibility: legacy text-only client ───────────────────

describe("backward compatibility with text-only clients", () => {
  it("accepts a legacy {content} body (no attachmentIds key) unchanged", async () => {
    const key = await mintKey("compat1");
    // Old client never sends attachmentIds — the zod schema defaults it to [].
    const res = await app.request("/messages", {
      method: "POST",
      headers: { ...auth(key), "content-type": "application/json" },
      body: JSON.stringify({ content: "legacy text" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.content).toBe("legacy text");
    // No attachments key in the broadcast/echo for plain text.
    expect(body.attachments ?? []).toEqual([]);
  });
});
