import { renderWithI18n } from "@/test/i18n-wrap";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Channel } from "@club/shared";

import { ChannelList } from "./channel-list";

const channels: Channel[] = [
  { id: "r1", slug: "general", createdAt: 0, lastActivityAt: 100, displayName: null },
  { id: "r2", slug: "deploy-debug", createdAt: 0, lastActivityAt: 200, displayName: null },
  { id: "r3", slug: "internal", createdAt: 0, lastActivityAt: 300, displayName: null },
];

describe("ChannelList", () => {
  it("renders all channels and marks the current one with aria-current", () => {
    renderWithI18n(
      <ChannelList
        channels={channels}
        currentChannel="deploy-debug"
        unread={{}}
        onSelect={() => {}}
        onCreate={async () => {}}
      />,
    );
    const rows = screen.getAllByRole("button");
    // 3 channels + the "+ new channel" trigger.
    expect(rows.length).toBe(4);
    const active = screen.getByTestId("channel-row-deploy-debug");
    expect(active.getAttribute("aria-current")).toBe("page");
    expect(active.className).toContain("bg-accent");
  });

  it("calls onSelect with the slug when a channel is clicked", () => {
    const onSelect = vi.fn();
    renderWithI18n(
      <ChannelList channels={channels} currentChannel="general" unread={{}} onSelect={onSelect} onCreate={async () => {}} />,
    );
    fireEvent.click(screen.getByTestId("channel-row-internal"));
    expect(onSelect).toHaveBeenCalledWith("internal");
  });

  it("shows an amber pill + left bar for a channel with an unread @mention", () => {
    renderWithI18n(
      <ChannelList
        channels={channels}
        currentChannel="general"
        unread={{ "deploy-debug": { count: 3, mention: true } }}
        onSelect={() => {}}
        onCreate={async () => {}}
      />,
    );
    const row = screen.getByTestId("channel-row-deploy-debug");
    // mention wash on the (non-active) row
    expect(row.className).toContain("border-l-human");
    // the pill text is the count
    expect(row.textContent).toContain("3");
  });

  it("creates a channel from the inline input on Enter with a valid slug", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderWithI18n(
      <ChannelList channels={channels} currentChannel="general" unread={{}} onSelect={() => {}} onCreate={onCreate} />,
    );
    fireEvent.click(screen.getByTestId("new-channel-button"));
    const input = screen.getByTestId("new-channel-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "my-channel" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() => expect(onCreate).toHaveBeenCalledWith("my-channel"));
  });

  it("shakes + marks invalid on Enter with an illegal slug, without calling onCreate", () => {
    const onCreate = vi.fn();
    renderWithI18n(
      <ChannelList channels={channels} currentChannel="general" unread={{}} onSelect={() => {}} onCreate={onCreate} />,
    );
    fireEvent.click(screen.getByTestId("new-channel-button"));
    const input = screen.getByTestId("new-channel-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Bad Slug!" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCreate).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.className).toContain("animate-shake");
  });
});
