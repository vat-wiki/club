import { afterEach, beforeEach,describe, expect, it, vi } from "vitest";

import type { Message } from "@club/shared";

import { runSearch, type SearchDeps } from "./search.js";

const baseMessage: Omit<Message, "id" | "createdAt"> = {
  participantId: "p_1",
  content: "hello",
  room: "general",
};

function msg(id: string, room = "general", content = "hello"): Message {
  return { ...baseMessage, id, content, room, createdAt: Date.now() };
}

function makeDeps(over: Partial<SearchDeps> = {}): SearchDeps {
  return {
    search: vi.fn().mockResolvedValue([]),
    ...over,
  };
}

describe("runSearch", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints 'no results' when the search returns an empty list", async () => {
    const deps = makeDeps();
    await runSearch({ query: "missing", limit: 10 }, deps);
    expect(console.log).toHaveBeenCalledWith('no results for "missing"');
  });

  it("passes the trimmed query, room and limit through to deps.search", async () => {
    const deps = makeDeps({
      search: vi.fn().mockResolvedValue([msg("m1")]),
    });
    await runSearch({ query: "  foo  ", room: "dev", limit: 20 }, deps);
    expect(deps.search).toHaveBeenCalledWith("  foo  ", {
      room: "dev",
      limit: 20,
    });
  });

  it("prints found-count with singular 'message' for one result", async () => {
    const deps = makeDeps({
      search: vi.fn().mockResolvedValue([msg("m1")]),
    });
    await runSearch({ query: "q", limit: 10 }, deps);
    expect(console.log).toHaveBeenCalledWith("found 1 message:");
  });

  it("prints found-count with plural 'messages' for multiple results", async () => {
    const deps = makeDeps({
      search: vi.fn().mockResolvedValue([msg("m1"), msg("m2")]),
    });
    await runSearch({ query: "q", limit: 10 }, deps);
    expect(console.log).toHaveBeenCalledWith("found 2 messages:");
  });

  it("formats messages newest-first via reverse order", async () => {
    const newer = msg("m_new", "general", "new");
    const older = msg("m_old", "general", "old");
    const deps = makeDeps({
      search: vi.fn().mockResolvedValue([newer, older]), // API returns newest-first
    });
    await runSearch({ query: "q", limit: 10 }, deps);
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
    const bodyLines = calls
      .map((c) => c[0])
      .filter((t) => typeof t === "string" && !t.startsWith("found"));
    // reversed order means older content appears before newer in output
    const idxOld = bodyLines.findIndex((t) => String(t).includes(older.content));
    const idxNew = bodyLines.findIndex((t) => String(t).includes(newer.content));
    expect(idxOld).toBeLessThan(idxNew);
  });

  it("prefers non-general messages with a #[room] tag", async () => {
    const deps = makeDeps({
      search: vi.fn().mockResolvedValue([msg("m1", "dev", "hi")]),
    });
    await runSearch({ query: "q", limit: 10 }, deps);
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c) => typeof c[0] === "string" && c[0].includes("#dev]"))).toBe(true);
  });

  it("propagates an SDK error through to the caller", async () => {
    const deps = makeDeps({
      search: vi.fn().mockRejectedValue(new Error("server offline")),
    });
    await expect(runSearch({ query: "q", limit: 10 }, deps)).rejects.toThrow(
      "server offline",
    );
  });
});
