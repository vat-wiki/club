import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ClubConn } from "@club/sdk";
import type { Message } from "@club/shared";

// The hook only talks to api.rooms / api.createRoom over the network; the
// unread/mention/sort logic under test is pure in-memory routing.
vi.mock("@/lib/api", () => ({
  api: {
    rooms: vi.fn(),
    createRoom: vi.fn(),
  },
}));

import { api } from "@/lib/api";
import { useRooms } from "./use-rooms";

const conn: ClubConn = { server: "http://x", key: "club_human_test" };

function msg(room: string, content: string, id: string, at = Date.now()): Message {
  return {
    id,
    participantId: "p2",
    authorName: "bot",
    content,
    createdAt: at,
    room,
  };
}

// Flush pending async state updates (the room-list fetch resolves on a
// microtask). vi.waitFor inside act doesn't reliably flush React state here, so
// we drain the queue with a short timer wrapped in act.
function flush() {
  return act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  (api.rooms as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: "r1", slug: "general", createdAt: 0, lastActivityAt: 100 },
    { id: "r2", slug: "deploy-debug", createdAt: 0, lastActivityAt: 200 },
  ]);
});

describe("useRooms — unread + mention routing", () => {
  it("increments unread for a non-focused room and ignores the focused one", async () => {
    localStorage.setItem("club_room", "general");
    const { result } = renderHook(() => useRooms(conn, "alice"));
    await act(async () => {
      result.current.recordIncoming(msg("deploy-debug", "hi", "m1"));
      result.current.recordIncoming(msg("general", "current room msg", "m2"));
    });
    expect(result.current.unread["deploy-debug"]).toEqual({ count: 1, mention: false });
    expect(result.current.unread["general"]).toBeUndefined();
  });

  it("fires a toast for a cross-room @mention and flags the room mention", async () => {
    localStorage.setItem("club_room", "general");
    const { result } = renderHook(() => useRooms(conn, "alice"));
    await act(async () => {
      result.current.recordIncoming(msg("deploy-debug", "hey @alice look", "m1"));
    });
    expect(result.current.unread["deploy-debug"]).toEqual({ count: 1, mention: true });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].room).toBe("deploy-debug");
    expect(result.current.toasts[0].messageId).toBe("m1");
  });

  it("does not fire a toast for a mention in the focused room", async () => {
    localStorage.setItem("club_room", "general");
    const { result } = renderHook(() => useRooms(conn, "alice"));
    await act(async () => {
      result.current.recordIncoming(msg("general", "hey @alice", "m1"));
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  it("dedupes toasts for the same message (reconnect catch-up redelivery)", async () => {
    localStorage.setItem("club_room", "general");
    const { result } = renderHook(() => useRooms(conn, "alice"));
    await act(async () => {
      result.current.recordIncoming(msg("deploy-debug", "hey @alice", "m1"));
      result.current.recordIncoming(msg("deploy-debug", "hey @alice", "m1"));
    });
    expect(result.current.toasts).toHaveLength(1);
  });
});

describe("useRooms — switching", () => {
  it("clears the target room's unread + toasts and persists the choice", async () => {
    localStorage.setItem("club_room", "general");
    const { result } = renderHook(() => useRooms(conn, "alice"));
    await act(async () => {
      result.current.recordIncoming(msg("deploy-debug", "hey @alice", "m1"));
    });
    expect(result.current.toasts).toHaveLength(1);
    act(() => {
      result.current.switchRoom("deploy-debug");
    });
    expect(result.current.currentRoom).toBe("deploy-debug");
    expect(result.current.unread["deploy-debug"]).toEqual({ count: 0, mention: false });
    expect(result.current.toasts).toHaveLength(0);
    expect(localStorage.getItem("club_room")).toBe("deploy-debug");
  });
});

describe("useRooms — sorting (unread-first, then most-recently-active)", () => {
  it("surfaces unread rooms before read ones regardless of activity", async () => {
    localStorage.setItem("club_room", "general");
    const { result } = renderHook(() => useRooms(conn, "alice"));
    await flush();
    expect(result.current.rooms.length).toBe(2);
    // Both read: deploy-debug (newer activity 200) sorts before general (100).
    expect(result.current.sortedRooms.map((r) => r.slug)).toEqual(["deploy-debug", "general"]);
    // Bump deploy-debug unread (general stays focused/read). Unread must lead.
    await act(async () => {
      result.current.recordIncoming(msg("deploy-debug", "ping", "m10", 50));
    });
    expect(result.current.sortedRooms.map((r) => r.slug)).toEqual(["deploy-debug", "general"]);
    expect(result.current.unread["deploy-debug"]?.count).toBe(1);
  });

  it("an unread room with older activity still sorts ahead of a read room", async () => {
    localStorage.setItem("club_room", "deploy-debug");
    const { result } = renderHook(() => useRooms(conn, "alice"));
    await flush();
    // general (activity 100) gets unread while deploy-debug (200) is focused.
    await act(async () => {
      result.current.recordIncoming(msg("general", "hello", "m1", 50));
    });
    const slugs = result.current.sortedRooms.map((r) => r.slug);
    expect(slugs[0]).toBe("general"); // unread-first despite older activity
  });
});
