import { describe, it, expect, vi } from "vitest";
import { runSend, type SendDeps } from "./send-impl.js";

// Fakes for the SDK functions runSend depends on. `calls` records every
// interaction so we can assert order + arguments.
function makeDeps(over: Partial<SendDeps> = {}): SendDeps & {
  uploads: string[];
  sent: { content: string; attachmentIds?: string[]; room?: string }[];
} {
  const uploads: string[] = [];
  const sent: { content: string; attachmentIds?: string[]; room?: string }[] = [];
  const base: SendDeps & { uploads: string[]; sent: typeof sent } = {
    uploads,
    sent,
    uploadImage: async (_conn, p) => {
      uploads.push(p);
      return { id: "att_" + p };
    },
    send: async (content, attachmentIds, room) => {
      sent.push({ content, attachmentIds, room });
    },
  };
  // Let a test override either function; the tracker arrays stay live so the
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

  it("throws when neither text nor images are given", async () => {
    const deps = makeDeps();
    await expect(runSend({ content: "", images: [], conn: CONN }, deps)).rejects.toThrow(
      /no message/,
    );
    expect(deps.uploads).toEqual([]);
    expect(deps.sent).toEqual([]);
  });

  it("fails fast on too many images without uploading any", async () => {
    const deps = makeDeps();
    await expect(
      runSend({ content: "", images: Array(9).fill("a.png"), conn: CONN }, deps),
    ).rejects.toThrow(/too many images/);
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

  it("threads the room through to send (posts to the resolved room)", async () => {
    const deps = makeDeps();
    await runSend(
      { content: "hi", images: [], conn: CONN, room: "deploy-debug" },
      deps,
    );
    expect(deps.sent).toEqual([{ content: "hi", attachmentIds: undefined, room: "deploy-debug" }]);
  });

  it("passes room: undefined when no room is set (server then defaults to general)", async () => {
    const deps = makeDeps();
    await runSend({ content: "hi", images: [], conn: CONN }, deps);
    expect(deps.sent[0]?.room).toBeUndefined();
  });
});
