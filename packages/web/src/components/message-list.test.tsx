import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { Message, Participant } from "@club/shared";

import { renderWithI18n } from "@/test/i18n-wrap";
import { MessageList } from "./message-list";

// Behavioral coverage for the bubble + alignment scheme (P0-1) and the
// self-mention row-level signal (P0-2 layer 2). We assert on class names
// because jsdom has no layout engine; the rendered class string is the
// contract the styles hang off, and these guard against regressions where
// `self` stops influencing the row layout (the original bug: `self && ""`).

const me: Participant = { id: "p1", name: "alice", kind: "human", createdAt: 0 };
const bot: Participant = { id: "p2", name: "bot", kind: "agent", createdAt: 0 };
const members: Participant[] = [me, bot];

function mk(p: Participant, content: string, id: string): Message {
  return {
    id,
    participantId: p.id,
    authorName: p.name,
    authorKind: p.kind,
    content,
    createdAt: Date.now(),
  };
}

// Locate the outer MessageRow flex div that contains `needle` text. Each row
// root carries the `animate-slide-in` class, so we filter on that.
function rowContaining(container: HTMLElement, needle: string): HTMLElement {
  const rows = container.querySelectorAll<HTMLElement>(".animate-slide-in");
  for (const r of rows) {
    if (r.textContent?.includes(needle)) return r;
  }
  throw new Error(`no row contains "${needle}"`);
}

describe("MessageList — own vs others + self-mention signal", () => {
  it("right-aligns own message rows (flex-row-reverse) and tints the bubble primary", () => {
    const messages = [
      mk(me, "hello from alice herself", "own"),
      mk(bot, "hi from the bot here", "other"),
    ];
    const { container } = renderWithI18n(
      <MessageList messages={messages} me={me} members={members} status="connected" />,
    );

    const ownRow = rowContaining(container, "from alice herself");
    const otherRow = rowContaining(container, "from the bot");

    // own row container is reversed so the dot + bubble sit on the right
    expect(ownRow.className).toContain("flex-row-reverse");
    // others' row is NOT reversed
    expect(otherRow.className).not.toContain("flex-row-reverse");

    // own bubble uses the primary tint; others use bg-card.
    // querySelector with a "/" in the class needs escaping in the CSS
    // selector, so we use the [class~="..."] attribute form instead.
    const ownBubble = ownRow.querySelector('[class~="bg-primary/15"]');
    const otherBubble = otherRow.querySelector(".bg-card");
    expect(ownBubble).toBeTruthy();
    expect(otherBubble).toBeTruthy();
    expect(ownRow.querySelector(".bg-card")).toBeNull();
    expect(otherRow.querySelector('[class~="bg-primary/15"]')).toBeNull();
  });

  it("flags a row that @mentions the current user with a primary wash + left bar", () => {
    const messages = [
      mk(bot, "hey @alice you there", "pinged"),
      mk(bot, "just chatting here", "other"),
    ];
    const { container } = renderWithI18n(
      <MessageList messages={messages} me={me} members={members} status="connected" />,
    );
    const pingedRow = rowContaining(container, "@alice you there");
    const otherRow = rowContaining(container, "just chatting");

    expect(pingedRow.className).toContain("bg-primary/5");
    expect(pingedRow.className).toContain("border-l-primary/40");
    expect(otherRow.className).not.toContain("bg-primary/5");
  });

  it("renders the inline self-mention mark in the primary palette (not amber)", () => {
    const messages = [mk(bot, "hey @alice you there", "pinged")];
    const { container } = renderWithI18n(
      <MessageList messages={messages} me={me} members={members} status="connected" />,
    );
    const mark = container.querySelector("mark");
    expect(mark).toBeTruthy();
    expect(mark?.textContent).toBe("@alice");
    expect(mark?.className).toContain("bg-primary/25");
    expect(mark?.className).toContain("text-primary");
    expect(mark?.className).not.toContain("bg-human-soft");
  });

  it("renders an other-mention mark in the amber palette", () => {
    // alice's own message pinging bot — bot is NOT self, so amber
    const messages = [mk(me, "ping @bot please", "m1")];
    const { container } = renderWithI18n(
      <MessageList messages={messages} me={me} members={members} status="connected" />,
    );
    const mark = container.querySelector("mark");
    expect(mark).toBeTruthy();
    expect(mark?.className).toContain("bg-human-soft");
    expect(mark?.className).toContain("text-human");
    expect(mark?.className).not.toContain("bg-primary");
  });
});

describe("MessageList — image attachments", () => {
  function mkWithAttachments(
    p: Participant,
    content: string,
    id: string,
    attachments: Message["attachments"],
  ): Message {
    return { ...mk(p, content, id), attachments };
  }

  const single = [
    {
      id: "att1",
      url: "/files/att1",
      mime: "image/png" as const,
      width: 100,
      height: 100,
      size: 100,
    },
  ];

  it("renders a single-image thumbnail inside the bubble with an accessible open button", () => {
    const messages = [mkWithAttachments(bot, "see this", "m1", single)];
    const { container } = renderWithI18n(
      <MessageList messages={messages} me={me} members={members} status="connected" />,
    );
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    // src resolved against the origin
    expect(img?.getAttribute("src")).toContain("/files/att1");
    // the thumbnail is a button (keyboard-reachable lightbox trigger)
    const openBtn = screen.getByLabelText(/放大查看图片 1/);
    expect(openBtn.tagName).toBe("BUTTON");
  });

  it("renders a pure-image message (no text) with just the gallery", () => {
    const messages = [mkWithAttachments(bot, "", "m1", single)];
    const { container } = renderWithI18n(
      <MessageList messages={messages} me={me} members={members} status="connected" />,
    );
    expect(container.querySelector("img")).toBeTruthy();
    expect(screen.getByLabelText(/放大查看图片 1/)).toBeTruthy();
  });

  it("uses a 2-col grid for multiple images", () => {
    const two = [
      ...single,
      { id: "att2", url: "/files/att2", mime: "image/png" as const, width: 1, height: 1, size: 1 },
    ];
    const messages = [mkWithAttachments(bot, "two imgs", "m1", two)];
    const { container } = renderWithI18n(
      <MessageList messages={messages} me={me} members={members} status="connected" />,
    );
    // the grid wrapper carries grid-cols-2; thumbnails are aspect-square
    const grid = container.querySelector('[class~="grid-cols-2"]');
    expect(grid).toBeTruthy();
    expect(container.querySelectorAll("img")).toHaveLength(2);
  });
});

describe("MessageList — optimistic send states", () => {
  it("fades a 'sending' row and labels it as in-flight", () => {
    const messages: Message[] = [{ ...mk(me, "on its way", "opt1"), status: "sending" }];
    const { container } = renderWithI18n(
      <MessageList messages={messages} me={me} members={members} status="connected" />,
    );
    const row = rowContaining(container, "on its way");
    const bubble = row.querySelector(".rounded-lg");
    expect(bubble?.className).toContain("opacity-60");
    expect(row.textContent).toContain("发送中");
  });

  it("tints a 'failed' row destructive and shows the send-failed label", () => {
    const messages: Message[] = [{ ...mk(me, "borked send", "opt2"), status: "failed" }];
    const { container } = renderWithI18n(
      <MessageList messages={messages} me={me} members={members} status="connected" />,
    );
    const row = rowContaining(container, "borked send");
    const bubble = row.querySelector(".rounded-lg");
    expect(bubble?.className).toContain("border-destructive/50");
    expect(row.textContent).toContain("发送失败");
  });
});

describe("MessageList — scroll-up pagination", () => {
  it("calls onLoadMore when scrolled to the top", () => {
    const onLoadMore = vi.fn();
    const messages = [mk(me, "topmost", "1"), mk(bot, "below", "2")];
    const { container } = renderWithI18n(
      <MessageList messages={messages} me={me} members={members} status="connected" onLoadMore={onLoadMore} />,
    );
    const log = container.querySelector('[role="log"]')!;
    // jsdom leaves scrollTop at 0 (== the top), so a scroll event there should
    // request older history.
    fireEvent.scroll(log);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("does not call onLoadMore while a load is already in flight", () => {
    const onLoadMore = vi.fn();
    const messages = [mk(me, "topmost", "1")];
    const { container } = renderWithI18n(
      <MessageList messages={messages} me={me} members={members} status="connected" onLoadMore={onLoadMore} loadingMore />,
    );
    const log = container.querySelector('[role="log"]')!;
    fireEvent.scroll(log);
    expect(onLoadMore).not.toHaveBeenCalled();
  });
});
