import { renderWithI18n } from "@/test/i18n-wrap";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Participant } from "@club/shared";

import { MentionPopup } from "./mention-popup";

function makeMembers(count: number): Participant[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `id_${i}`,
    name: `user${i}`,
    createdAt: 1000 + i,
  }));
}

function renderPopup(members: Participant[], opts: Partial<Parameters<typeof MentionPopup>[0]> = {}) {
  return renderWithI18n(
    <MentionPopup
      members={members}
      activeIndex={opts.activeIndex ?? 0}
      query={opts.query ?? ""}
      anchor={opts.anchor ?? { top: 100, left: 50 }}
      onSelect={opts.onSelect ?? vi.fn()}
      onHover={opts.onHover ?? vi.fn()}
    />,
  );
}

describe("MentionPopup", () => {
  it("renders member options from the list", () => {
    const members = makeMembers(3);
    renderPopup(members);
    expect(screen.getByTestId("mention-popup")).toBeInTheDocument();
    expect(screen.getAllByTestId("mention-option")).toHaveLength(3);
    expect(screen.getByText("user0")).toBeInTheDocument();
  });

  it("displays the no-match message when no members", () => {
    renderPopup([], { query: "xyz" });
    expect(screen.getByTestId("mention-popup")).toBeInTheDocument();
    // No-match text should be present (in Chinese by default)
    expect(screen.getByTestId("mention-popup")).toHaveTextContent("没有匹配");
  });

  it("highlights the active option", () => {
    renderPopup(makeMembers(3), { activeIndex: 1 });
    const options = screen.getAllByTestId("mention-option");
    expect(options[1]).toHaveAttribute("data-active", "");
    expect(options[0]).not.toHaveAttribute("data-active");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
  });

  it("caps visible options at MENTION_MAX_VISIBLE", () => {
    const members = makeMembers(100);
    const { container } = renderPopup(members);
    const options = container.querySelectorAll('[data-testid="mention-option"]');
    expect(options.length).toBeLessThanOrEqual(10); // MENTION_MAX_VISIBLE
  });

  it("shows 'more' overflow hint when exceeding max visible", () => {
    const members = makeMembers(20);
    renderPopup(members);
    // i18n defaults to zh; the overflow text contains "更多" (more)
    expect(screen.getByTestId("mention-popup")).toHaveTextContent("更多");
  });

  it("calls onSelect when an option is clicked", async () => {
    const onSelect = vi.fn();
    const members = makeMembers(2);
    renderPopup(members, { onSelect });
    const options = screen.getAllByTestId("mention-option");
    await userEvent.click(options[1]);
    expect(onSelect).toHaveBeenCalledWith(members[1]);
  });

  it("calls onHover when mouse enters an option", async () => {
    const onHover = vi.fn();
    renderPopup(makeMembers(3), { onHover });
    const options = screen.getAllByTestId("mention-option");
    await userEvent.hover(options[2]);
    expect(onHover).toHaveBeenCalledWith(2);
  });

  it("positions the popup using anchor coordinates", () => {
    renderPopup(makeMembers(1), { anchor: { top: 200, left: 100 } });
    const popup = screen.getByTestId("mention-popup");
    expect(popup).toHaveStyle({ left: "100px" });
  });

  it("prevents pointer down from blurring the textarea", () => {
    const onSelect = vi.fn();
    renderPopup(makeMembers(1), { onSelect });
    const popup = screen.getByTestId("mention-popup");
    const event = new MouseEvent("pointerdown", { bubbles: true });
    const preventSpy = vi.spyOn(event, "preventDefault");
    (popup as HTMLElement).dispatchEvent(event);
    expect(preventSpy).toHaveBeenCalled();
  });
});
