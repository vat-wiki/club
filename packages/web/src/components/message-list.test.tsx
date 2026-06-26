import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { Message, Participant } from "@club/shared";

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
    const { container } = render(
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
    const { container } = render(
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
    const { container } = render(
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
    const { container } = render(
      <MessageList messages={messages} me={me} members={members} status="connected" />,
    );
    const mark = container.querySelector("mark");
    expect(mark).toBeTruthy();
    expect(mark?.className).toContain("bg-human-soft");
    expect(mark?.className).toContain("text-human");
    expect(mark?.className).not.toContain("bg-primary");
  });
});
