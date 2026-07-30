import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";
import { afterAll, describe, expect, it, vi } from "vitest";

// Multi-channel acceptance: MR2 (backward compat), MR3 (parity/open access),
// MR4 (topic isolation), MR5 (channel lifecycle), MR6 server face (GET /channels),
// MR10 (channel-scoped stream), MR11 (cross-channel mention carries channel).

const dbPath = join(tmpdir(), `club-channels-${randomUUID()}.db`);
process.env.CLUB_DB = dbPath;

const { channels } = await import("./channels.js");
const { messages } = await import("./messages.js");
const { participants } = await import("./participants.js");
const { me } = await import("./me.js");
const streamMod = await import("../stream.js");

const app = new Hono();
app.route("/participants", participants);
app.route("/messages", messages);
app.route("/me", me);
app.route("/channels", channels);

afterAll(() => {
  for (const ext of ["", "-wal", "-shm"]) rmSync(dbPath + ext, { force: true });
});

async function mint(name: string): Promise<string> {
  const res = await app.request("/participants", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return (await res.json()).key;
}
function auth(key: string) {
  return { "content-type": "application/json", authorization: `Bearer ${key}` };
}
async function postMsg(
  key: string,
  content: string,
  channel?: string,
): Promise<any> {
  const body: Record<string, unknown> = { content };
  if (channel) body.channel = channel;
  const res = await app.request("/messages", {
    method: "POST",
    headers: auth(key),
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
async function getMsgs(key: string, channel?: string): Promise<any[]> {
  const qs = channel ? `?channel=${channel}` : "";
  const res = await app.request(`/messages${qs}`, { headers: auth(key) });
  return await res.json();
}

// ── MR2: backward compatibility ─────────────────────────────────────
describe("MR2 — omitting channel defaults to general (old clients unbroken)", () => {
  it("POST /messages without channel lands in general and echoes channel='general'", async () => {
    const key = await mint("mr2-human");
    const { status, body } = await postMsg(key, "legacy send");
    expect(status).toBe(201);
    expect(body.channel).toBe("general");
  });

  it("GET /messages without channel returns general history", async () => {
    const key = await mint("mr2-b");
    await postMsg(key, "in general 1");
    const list = await getMsgs(key); // no channel param
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((m) => m.channel === "general")).toBe(true);
    expect(list.some((m) => m.content === "in general 1")).toBe(true);
  });
});

// ── MR3: parity / open access (channel is NOT an auth axis) ─────────────
describe("MR3 — human and agent keys read/write every channel (no 403)", () => {
  it("both key kinds succeed posting + reading across multiple channels", async () => {
    const human = await mint("mr3-human");
    const agent = await mint("mr3-agent");
    // Ensure two non-general channels exist.
    for (const slug of ["mr3-alpha", "mr3-beta"]) {
      await app.request("/channels", { method: "POST", headers: auth(human), body: JSON.stringify({ name: slug }) });
    }
    const matrix = [
      { key: human, channel: "mr3-alpha" },
      { key: human, channel: "mr3-beta" },
      { key: agent, channel: "mr3-alpha" },
      { key: agent, channel: "mr3-beta" },
    ];
    for (const { key, channel } of matrix) {
      const post = await postMsg(key, `hi from ${channel}`, channel);
      expect(post.status).toBe(201);
      const got = await getMsgs(key, channel);
      expect(got.some((m) => m.content === `hi from ${channel}`)).toBe(true);
    }
  });
});

// ── MR4: topic isolation ────────────────────────────────────────────
describe("MR4 — a channel's messages do not leak into another channel", () => {
  it("GET /messages?channel=A does not return channel B messages", async () => {
    const key = await mint("mr4");
    await postMsg(key, "only in alpha", "mr4-alpha");
    await postMsg(key, "only in beta", "mr4-beta");

    const alpha = await getMsgs(key, "mr4-alpha");
    const beta = await getMsgs(key, "mr4-beta");
    expect(alpha.some((m) => m.content === "only in alpha")).toBe(true);
    expect(alpha.some((m) => m.content === "only in beta")).toBe(false);
    expect(beta.some((m) => m.content === "only in beta")).toBe(true);
    expect(beta.some((m) => m.content === "only in alpha")).toBe(false);
  });

  it("POST to a non-existent (but valid) channel auto-creates it", async () => {
    const key = await mint("mr4-auto");
    const { status } = await postMsg(key, "creates the channel", "mr4-implicit");
    expect(status).toBe(201);
    const res = await app.request("/channels", { headers: auth(key) });
    const slugs = (await res.json()).map((r: any) => r.slug);
    expect(slugs).toContain("mr4-implicit");
  });
});

// ── MR5: channel lifecycle ─────────────────────────────────────────────
describe("MR5 — POST /channels lifecycle (validation + idempotency)", () => {
  it("rejects an invalid slug with 400", async () => {
    const key = await mint("mr5");
    for (const bad of ["UPPER", "has space", "no_underscore-bad?x", "-leading", "", "a".repeat(31)]) {
      const res = await app.request("/channels", {
        method: "POST",
        headers: auth(key),
        body: JSON.stringify({ name: bad }),
      });
      expect(res.status, `slug "${bad}" should be 400`).toBe(400);
    }
  });

  it("accepts a valid slug and returns the channel (201)", async () => {
    const key = await mint("mr5-ok");
    const res = await app.request("/channels", {
      method: "POST",
      headers: auth(key),
      body: JSON.stringify({ name: "mr5-valid" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ slug: "mr5-valid", lastActivityAt: null });
    expect(body.id).toBeTruthy();
    expect(body.createdAt).toEqual(expect.any(Number));
  });

  it("is idempotent — re-creating returns the existing channel (200, same id)", async () => {
    const key = await mint("mr5-idem");
    const first = await app.request("/channels", {
      method: "POST",
      headers: auth(key),
      body: JSON.stringify({ name: "mr5-dup" }),
    });
    const second = await app.request("/channels", {
      method: "POST",
      headers: auth(key),
      body: JSON.stringify({ name: "mr5-dup" }),
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200); // already existed
    expect((await first.json()).id).toBe((await second.json()).id);
  });

  it("POST /channels {name:'general'} returns the seeded general channel (not an error)", async () => {
    const key = await mint("mr5-gen");
    const res = await app.request("/channels", {
      method: "POST",
      headers: auth(key),
      body: JSON.stringify({ name: "general" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).slug).toBe("general");
  });

  it("requires auth", async () => {
    const res = await app.request("/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "mr5-noauth" }),
    });
    expect(res.status).toBe(401);
  });
});

// ── MR6 (server face): GET /channels shape + lastActivityAt ─────────────
describe("MR6 — GET /channels returns every channel with lastActivityAt", () => {
  it("lists general + created channels, general first, with correct lastActivityAt", async () => {
    const key = await mint("mr6");
    // Post into general and a fresh channel so lastActivityAt diverges.
    await postMsg(key, "activity in general");
    await app.request("/channels", { method: "POST", headers: auth(key), body: JSON.stringify({ name: "mr6-quiet" }) });
    await postMsg(key, "activity in loud", "mr6-loud");

    const res = await app.request("/channels", { headers: auth(key) });
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list.map((r: any) => r.slug)).toEqual(expect.arrayContaining(["general", "mr6-loud", "mr6-quiet"]));

    const general = list.find((r: any) => r.slug === "general");
    const loud = list.find((r: any) => r.slug === "mr6-loud");
    const quiet = list.find((r: any) => r.slug === "mr6-quiet");
    expect(general.lastActivityAt).toEqual(expect.any(Number));
    expect(loud.lastActivityAt).toEqual(expect.any(Number));
    expect(quiet.lastActivityAt).toBeNull(); // empty channel

    // Exact contract shape (camelCase, no snake_case leak).
    expect(Object.keys(loud).sort()).toEqual(
      ["id", "slug", "createdAt", "lastActivityAt"].sort(),
    );
    // Ordering: general first.
    expect(list[0].slug).toBe("general");
  });
});

// ── MR10: channel-scoped SSE stream ────────────────────────────────────
//
// We register a fake subscriber scoped to channel A directly with the stream
// module (its writeAll filter is what the route relies on), then assert it
// receives A's message/deleted/reaction/thinking events but NOT B's. This
// exercises the real fan-out filter without standing up an HTTP SSE client.
describe("MR10 — a channel-A subscriber does not receive channel-B events", () => {
  function fakeStream() {
    const frames: { event?: string; data: string }[] = [];
    const sse = {
      // writeSSE is sync-invoked by writeAll; record each frame, resolve ok.
      writeSSE: async (frame: { event?: string; data: string }) => {
        frames.push(frame);
      },
    };
    return { sse, frames };
  }
  // A frame is a "message" event iff it has no `event:` field (default event).
  const messageData = (frames: { event?: string; data: string }[]) =>
    frames.filter((f) => f.event === undefined).map((f) => f.data);

  it("delivers channel-A messages but not channel-B messages", async () => {
    const sub = fakeStream();
    const unsub = streamMod.addSubscriber(
      sub.sse as any,
      { id: "p1", name: "p1" },
      new Set(["mr10-a"]),
    );
    try {
      streamMod.broadcast({
        id: "from-a",
        participantId: "x",
        authorName: "x",
        content: "a",
        createdAt: 1,
        channel: "mr10-a",
      });
      streamMod.broadcast({
        id: "from-b",
        participantId: "x",
        authorName: "x",
        content: "b",
        createdAt: 2,
        channel: "mr10-b",
      });
      await new Promise((r) => setTimeout(r, 0));
      const msgs = messageData(sub.frames).map((d) => JSON.parse(d).id);
      expect(msgs).toContain("from-a");
      expect(msgs).not.toContain("from-b");
    } finally {
      unsub();
    }
  });

  it("delivers channel-A message_deleted/reaction but not channel-B's", async () => {
    const sub = fakeStream();
    const unsub = streamMod.addSubscriber(
      sub.sse as any,
      { id: "p2", name: "p2" },
      new Set(["mr10-a"]),
    );
    try {
      streamMod.broadcastDeleted({ id: "d-a", channel: "mr10-a" });
      streamMod.broadcastDeleted({ id: "d-b", channel: "mr10-b" });
      streamMod.broadcastReaction({
        messageId: "r-a",
        reactions: [{ emoji: "👍", count: 1 }],
        channel: "mr10-a",
      });
      streamMod.broadcastReaction({
        messageId: "r-b",
        reactions: [{ emoji: "👍", count: 1 }],
        channel: "mr10-b",
      });
      await new Promise((r) => setTimeout(r, 0));
      const dels = sub.frames
        .filter((f) => f.event === "message_deleted")
        .map((f) => JSON.parse(f.data).id);
      const reacts = sub.frames
        .filter((f) => f.event === "message_reaction")
        .map((f) => JSON.parse(f.data).messageId);
      expect(dels).toContain("d-a");
      expect(dels).not.toContain("d-b");
      expect(reacts).toContain("r-a");
      expect(reacts).not.toContain("r-b");
    } finally {
      unsub();
    }
  });

  it("delivers channel-scoped agent_thinking only to the named channel", async () => {
    const subA = fakeStream();
    const subB = fakeStream();
    const unsubA = streamMod.addSubscriber(
      subA.sse as any,
      { id: "pa", name: "pa" },
      new Set(["mr10-think-a"]),
    );
    const unsubB = streamMod.addSubscriber(
      subB.sse as any,
      { id: "pb", name: "pb" },
      new Set(["mr10-think-b"]),
    );
    try {
      streamMod.broadcastAgentThinking({
        participantId: "agent1",
        name: "agent1",
        channel: "mr10-think-a",
      });
      await new Promise((r) => setTimeout(r, 0));
      const aThinking = subA.frames.some((f) => f.event === "agent_thinking");
      const bThinking = subB.frames.some((f) => f.event === "agent_thinking");
      expect(aThinking).toBe(true);
      expect(bThinking).toBe(false);
    } finally {
      unsubA();
      unsubB();
    }
  });

  it("a subscriber with no filter (null) receives all channels; presence is always global", async () => {
    const subAll = fakeStream();
    const unsub = streamMod.addSubscriber(
      subAll.sse as any,
      { id: "pall", name: "pall" },
      null,
    );
    try {
      streamMod.broadcast({
        id: "any-a",
        participantId: "x",
        authorName: "x",
        content: "a",
        createdAt: 1,
        channel: "mr10-all-a",
      });
      streamMod.broadcast({
        id: "any-b",
        participantId: "x",
        authorName: "x",
        content: "b",
        createdAt: 2,
        channel: "mr10-all-b",
      });
      await new Promise((r) => setTimeout(r, 0));
      const ids = messageData(subAll.frames).map((d) => JSON.parse(d).id);
      expect(ids).toEqual(expect.arrayContaining(["any-a", "any-b"]));
      // Presence (own online announcement) reaches the all-channels subscriber.
      expect(subAll.frames.some((f) => f.event === "presence")).toBe(true);
    } finally {
      unsub();
    }
  });
});

// ── MR11: cross-channel @mention carries the source channel ───────────────
describe("MR11 — a mention records the channel it happened in", () => {
  it("a @mention in channel R lands in the recipient inbox with channel=R", async () => {
    const recipient = await mint("mr11-target");
    const sender = await mint("mr11-sender");
    // Mention happens in a non-general channel.
    const { status } = await postMsg(sender, "hey @mr11-target look here", "mr11-channel");
    expect(status).toBe(201);

    const res = await app.request("/me/mentions", { headers: auth(recipient) });
    const list = await res.json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      authorName: "mr11-sender",
      content: "hey @mr11-target look here",
      channel: "mr11-channel",
    });
  });

  it("a mention in general carries channel='general'", async () => {
    const recipient = await mint("mr11-gen-target");
    const sender = await mint("mr11-gen-sender");
    await postMsg(sender, "ping @mr11-gen-target");

    const list = await (
      await app.request("/me/mentions", { headers: auth(recipient) })
    ).json();
    expect(list[0].channel).toBe("general");
  });
});

// Sanity: the broadcast spies used elsewhere don't leak into these assertions.
describe("stream filter is driven by the message payload's channel, not ambient state", () => {
  it("a delete in channel B does not broadcast into a channel-A-only subscriber", async () => {
    const spy = vi.spyOn(streamMod, "broadcastDeleted");
    const key = await mint("mr10-del");
    // create a message in channel B, then recall it; assert the event payload's channel.
    const { body } = await postMsg(key, "to be recalled", "mr10-del-b");
    const del = await app.request(`/messages/${body.id}`, {
      method: "DELETE",
      headers: auth(key),
    });
    expect(del.status).toBe(204);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: body.id, channel: "mr10-del-b" }));
    spy.mockRestore();
  });
});
