import { describe, expect,it } from "vitest";

import { runSend, type SendDeps } from "./send-impl.js";

// Fakes for the SDK functions runSend depends on. `uploads` records every
// interaction (image AND video) so we can assert order + arguments.
function makeDeps(over: Partial<SendDeps> = {}): SendDeps & {
  uploads: string[];
  sent: { content: string; attachmentIds?: string[]; channel?: string }[];
} {
  const uploads: string[] = [];
  const sent: { content: string; attachmentIds?: string[]; channel?: string }[] = [];
  const base: SendDeps & { uploads: string[]; sent: typeof sent } = {
    uploads,
    sent,
    uploadImage: async (_conn, p) => {
      uploads.push(p);
      return { id: "att_" + p };
    },
    uploadVideo: async (_conn, p) => {
      uploads.push(p);
      return { id: "att_" + p };
    },
    uploadDocument: async (_conn, p) => {
      uploads.push(p);
      return { id: "att_" + p };
    },
    send: async (content, attachmentIds, channel) => {
      sent.push({ content, attachmentIds, channel });
      return {
        id: "msg_1",
        participantId: "p_1",
        authorName: "test",
        content,
        createdAt: 1,
        channel,
      };
    },
  };
  // Let a test override any function; the tracker arrays stay live so the
  // test still sees uploads/sent from the base (an override is expected to push
  // or not, depending on what the test asserts).
  return { ...base, ...over };
}

const CONN = { server: "http://x", key: "k" };

describe("runSend", () => {
  it("sends a plain text message with no attachmentIds (legacy path)", async () => {
    const deps = makeDeps();
    const res = await runSend({ content: "hi", images: [], conn: CONN }, deps);
    expect(res.attachmentIds).toEqual([]);
    expect(deps.sent).toEqual([{ content: "hi", attachmentIds: undefined }]);
    expect(deps.uploads).toEqual([]);
  });

  it("uploads each --image then sends content + attachmentIds", async () => {
    const deps = makeDeps();
    await runSend(
      { content: "look", images: ["a.png", "b.jpg"], conn: CONN },
      deps,
    );
    expect(deps.uploads).toEqual(["a.png", "b.jpg"]);
    expect(deps.sent).toEqual([
      { content: "look", attachmentIds: ["att_a.png", "att_b.jpg"] },
    ]);
  });

  it("sends an image-only message (empty text + images)", async () => {
    const deps = makeDeps();
    await runSend({ content: "", images: ["x.png"], conn: CONN }, deps);
    expect(deps.sent).toEqual([{ content: "", attachmentIds: ["att_x.png"] }]);
  });

  it("uploads each --video then sends content + attachmentIds", async () => {
    const deps = makeDeps();
    await runSend(
      { content: "watch", images: [], videos: ["a.mp4", "b.webm"], conn: CONN },
      deps,
    );
    expect(deps.uploads).toEqual(["a.mp4", "b.webm"]);
    expect(deps.sent).toEqual([
      { content: "watch", attachmentIds: ["att_a.mp4", "att_b.webm"] },
    ]);
  });

  it("uploads a mix of --image and --video, images first (stable order)", async () => {
    const deps = makeDeps();
    await runSend(
      { content: "mix", images: ["a.png"], videos: ["b.mp4"], conn: CONN },
      deps,
    );
    expect(deps.uploads).toEqual(["a.png", "b.mp4"]);
    expect(deps.sent).toEqual([
      { content: "mix", attachmentIds: ["att_a.png", "att_b.mp4"] },
    ]);
  });

  it("sends a video-only message (empty text + videos)", async () => {
    const deps = makeDeps();
    await runSend({ content: "", videos: ["x.mp4"], conn: CONN }, deps);
    expect(deps.sent).toEqual([{ content: "", attachmentIds: ["att_x.mp4"] }]);
  });

  it("uploads each --file (document) then sends content + attachmentIds", async () => {
    const deps = makeDeps();
    await runSend(
      { content: "see doc", images: [], documents: ["a.pdf", "b.docx"], conn: CONN },
      deps,
    );
    expect(deps.uploads).toEqual(["a.pdf", "b.docx"]);
    expect(deps.sent).toEqual([
      { content: "see doc", attachmentIds: ["att_a.pdf", "att_b.docx"] },
    ]);
  });

  it("throws when neither text nor any attachment is given", async () => {
    const deps = makeDeps();
    await expect(runSend({ content: "", images: [], conn: CONN }, deps)).rejects.toThrow(
      /no message/,
    );
    expect(deps.uploads).toEqual([]);
    expect(deps.sent).toEqual([]);
  });

  it("fails fast on too many attachments (images + videos share the cap) without uploading any", async () => {
    const deps = makeDeps();
    await expect(
      runSend(
        {
          content: "",
          images: Array(6).fill("a.png"),
          videos: Array(5).fill("b.mp4"),
          conn: CONN,
        },
        deps,
      ),
    ).rejects.toThrow(/too many attachments/);
    expect(deps.uploads).toEqual([]);
  });

  it("surfaces a per-file upload error (e.g. missing/wrong-type image)", async () => {
    const deps = makeDeps({
      uploadImage: async () => {
        throw new Error("not a recognized image");
      },
    });
    await expect(
      runSend({ content: "", images: ["bad.png"], conn: CONN }, deps),
    ).rejects.toThrow(/not a recognized image/);
    // send must never have been called.
    expect(deps.sent).toEqual([]);
  });

  it("surfaces a per-file video upload error without sending", async () => {
    const deps = makeDeps({
      uploadVideo: async () => {
        throw new Error("not a recognized video");
      },
    });
    await expect(
      runSend({ content: "", videos: ["bad.mov"], conn: CONN }, deps),
    ).rejects.toThrow(/not a recognized video/);
    expect(deps.sent).toEqual([]);
  });

  it("stops at the first failing image and does not send a partial message", async () => {
    let i = 0;
    const deps = makeDeps({
      uploadImage: async (_conn, p) => {
        i++;
        if (i === 2) throw new Error("could not read second.png");
        return { id: "att_" + p };
      },
    });
    await expect(
      runSend({ content: "x", images: ["a.png", "second.png", "c.png"], conn: CONN }, deps),
    ).rejects.toThrow(/could not read second.png/);
    expect(deps.sent).toEqual([]); // no partial send
  });

  it("threads the channel through to send (posts to the resolved channel)", async () => {
    const deps = makeDeps();
    await runSend(
      { content: "hi", images: [], conn: CONN, channel: "deploy-debug" },
      deps,
    );
    expect(deps.sent).toEqual([{ content: "hi", attachmentIds: undefined, channel: "deploy-debug" }]);
  });

  it("passes channel: undefined when no channel is set (server then defaults to general)", async () => {
    const deps = makeDeps();
    await runSend({ content: "hi", images: [], conn: CONN }, deps);
    expect(deps.sent[0]?.channel).toBeUndefined();
  });

  it("forwards replyToId as the 4th arg to send (threaded reply)", async () => {
    // Override `send` to capture the replyToId positional arg, which the base
    // fake (3 params) would otherwise drop.
    const sent: { content: string; attachmentIds?: string[]; channel?: string; replyToId?: string }[] = [];
    const deps = makeDeps({
      send: async (content, attachmentIds, channel, replyToId) => {
        sent.push({ content, attachmentIds, channel, replyToId });
        return { id: "msg_1", participantId: "p_1", authorName: "test", content, createdAt: 1, channel };
      },
    });
    await runSend(
      { content: "reply!", images: [], conn: CONN, replyToId: "msg_parent" },
      deps,
    );
    expect(sent).toEqual([
      { content: "reply!", attachmentIds: undefined, channel: undefined, replyToId: "msg_parent" },
    ]);
  });

  it("forwards replyToId alongside a channel when both are set", async () => {
    const sent: { content: string; attachmentIds?: string[]; channel?: string; replyToId?: string }[] = [];
    const deps = makeDeps({
      send: async (content, attachmentIds, channel, replyToId) => {
        sent.push({ content, attachmentIds, channel, replyToId });
        return { id: "msg_1", participantId: "p_1", authorName: "test", content, createdAt: 1, channel };
      },
    });
    await runSend(
      { content: "hi", images: [], conn: CONN, channel: "dev", replyToId: "msg_parent" },
      deps,
    );
    expect(sent).toEqual([
      { content: "hi", attachmentIds: undefined, channel: "dev", replyToId: "msg_parent" },
    ]);
  });

  it("omits replyToId (undefined) when not set, leaving the send call unchanged", async () => {
    const sent: { content: string; attachmentIds?: string[]; channel?: string; replyToId?: string }[] = [];
    const deps = makeDeps({
      send: async (content, attachmentIds, channel, replyToId) => {
        sent.push({ content, attachmentIds, channel, replyToId });
        return { id: "msg_1", participantId: "p_1", authorName: "test", content, createdAt: 1, channel };
      },
    });
    await runSend({ content: "hi", images: [], conn: CONN }, deps);
    expect(sent[0]?.replyToId).toBeUndefined();
  });
});
