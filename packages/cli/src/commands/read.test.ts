import { afterEach,describe, expect, it, vi } from "vitest";

import type { ClubClient, Message } from "@club/sdk";

import { type ReadDeps,runRead } from "./read.js";

const MSG1: Message = {
  id: "msg_1",
  channelId: "general",
  participantId: "u1",
  participantName: "alice",
  content: "hello",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function freshDeps(overrides: Partial<ReadDeps> = {}): ReadDeps {
  return {
    getClient: vi.fn(),
    formatMessage: vi.fn((m: Message) => `[${m.participantName}] ${m.content}`),
    parseLimit: vi.fn((s: string) => Number(s)),
    defaultChannel: vi.fn(() => "general"),
    ...overrides,
  };
}

describe("runRead", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches messages with default limit 50", async () => {
    const client = { messages: vi.fn().mockResolvedValue([MSG1]) } as unknown as ClubClient;
    const deps = freshDeps({ getClient: vi.fn(() => client) });

    await runRead({ limit: "50" }, deps);

    expect(deps.parseLimit).toHaveBeenCalledWith("50");
    expect(client.messages).toHaveBeenCalledWith({
      since: undefined,
      before: undefined,
      limit: 50,
      channel: "general",
    });
  });

  it("passes since/before pagination when provided", async () => {
    const client = { messages: vi.fn().mockResolvedValue([]) } as unknown as ClubClient;
    const deps = freshDeps({ getClient: vi.fn(() => client) });

    await runRead({ limit: "20", since: "msg_a", before: "msg_b" }, deps);

    expect(client.messages).toHaveBeenCalledWith({
      since: "msg_a",
      before: "msg_b",
      limit: 20,
      channel: "general",
    });
  });

  it("uses --channel when supplied, otherwise falls back to defaultChannel", async () => {
    const client = { messages: vi.fn().mockResolvedValue([]) } as unknown as ClubClient;
    const deps = freshDeps({ getClient: vi.fn(() => client) });

    await runRead({ limit: "5", channel: "dev" }, deps);
    expect(deps.defaultChannel).not.toHaveBeenCalled();
    expect(client.messages).toHaveBeenLastCalledWith(
      expect.objectContaining({ channel: "dev" }),
    );

    // reset calls
    (client.messages as any).mockClear();
    (deps.defaultChannel as any).mockClear();
    await runRead({ limit: "5" }, deps);
    expect(deps.defaultChannel).toHaveBeenCalledTimes(1);
    expect(client.messages).toHaveBeenLastCalledWith(
      expect.objectContaining({ channel: "general" }),
    );
  });

  it("formats and prints each message", async () => {
    const client = { messages: vi.fn().mockResolvedValue([MSG1]) } as unknown as ClubClient;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const deps = freshDeps({ getClient: vi.fn(() => client) });

    await runRead({ limit: "10" }, deps);

    expect(deps.formatMessage).toHaveBeenCalledWith(MSG1);
    expect(log).toHaveBeenCalledWith("[alice] hello");
  });

  it("prints a no-messages note when the result is empty", async () => {
    const client = { messages: vi.fn().mockResolvedValue([]) } as unknown as ClubClient;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const deps = freshDeps({ getClient: vi.fn(() => client) });

    await runRead({ limit: "10" }, deps);

    expect(log).toHaveBeenCalledWith("(no messages)");
  });
});
