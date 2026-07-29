import { describe, expect,it } from "vitest";

import type { Room } from "@club/shared";

import { formatRoomLine } from "./rooms.js";

function makeRoom(slug: string, lastActivityAt: number | null = null): Room {
  return {
    id: "id_" + slug,
    slug,
    createdAt: 1719700000000,
    lastActivityAt,
  };
}

describe("formatRoomLine", () => {
  it("marks the current room with ' *'", () => {
    expect(formatRoomLine(makeRoom("deploy-debug"), "deploy-debug")).toBe("#deploy-debug *");
  });

  it("leaves a non-current room unmarked", () => {
    expect(formatRoomLine(makeRoom("deploy-debug"), "general")).toBe("#deploy-debug");
  });

  it("tags general as the system room", () => {
    expect(formatRoomLine(makeRoom("general"), "general")).toBe("#general * (system)");
  });

  it("tags general as system even when it is not the current room", () => {
    expect(formatRoomLine(makeRoom("general"), "deploy-debug")).toBe("#general (system)");
  });

  it("marks a custom current room with * and no system tag", () => {
    expect(formatRoomLine(makeRoom("build"), "build")).toBe("#build *");
  });

  it("shows plain line for non-current custom room", () => {
    expect(formatRoomLine(makeRoom("deploy-debug"), "build")).toBe("#deploy-debug");
  });
});
