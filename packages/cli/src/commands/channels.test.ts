import { describe, expect,it } from "vitest";

import type { Channel } from "@club/shared";

import { formatChannelLine } from "./channels.js";

function makeChannel(slug: string, lastActivityAt: number | null = null): Channel {
  return {
    id: "id_" + slug,
    slug,
    createdAt: 1719700000000,
    lastActivityAt,
  };
}

describe("formatChannelLine", () => {
  it("marks the current channel with ' *'", () => {
    expect(formatChannelLine(makeChannel("deploy-debug"), "deploy-debug")).toBe("#deploy-debug *");
  });

  it("leaves a non-current channel unmarked", () => {
    expect(formatChannelLine(makeChannel("deploy-debug"), "general")).toBe("#deploy-debug");
  });

  it("tags general as the system channel", () => {
    expect(formatChannelLine(makeChannel("general"), "general")).toBe("#general * (system)");
  });

  it("tags general as system even when it is not the current channel", () => {
    expect(formatChannelLine(makeChannel("general"), "deploy-debug")).toBe("#general (system)");
  });

  it("marks a custom current channel with * and no system tag", () => {
    expect(formatChannelLine(makeChannel("build"), "build")).toBe("#build *");
  });

  it("shows plain line for non-current custom channel", () => {
    expect(formatChannelLine(makeChannel("deploy-debug"), "build")).toBe("#deploy-debug");
  });
});
