import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import * as axe from "axe-core";
import type { AxeResults, RunOptions } from "axe-core";
import type { ReactNode } from "react";
import type { Message, Participant } from "@club/shared";

import { Composer } from "./composer";
import { Roster } from "./roster";
import { Topbar } from "./topbar";
import { MessageList } from "./message-list";
import { AuthDialog } from "./auth-dialog";
import { MobileRoster } from "./mobile-roster";
import { KeyRevealDialog } from "./key-reveal-dialog";
import { SignOutConfirmDialog } from "./sign-out-confirm-dialog";
import { ViewKeyDialog } from "./view-key-dialog";
import { withI18n } from "@/test/i18n-wrap";

const TEST_KEY = "club_human_test_0123456789abcdef";

const axeOptions: RunOptions = {
  runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
  rules: {
    // color-contrast needs a real layout/computed-style engine; jsdom can't
    // provide it, so the rule is non-deterministic here and spams stderr.
    // Contrast is verified at the browser level (see a11y audit script).
    "color-contrast": { enabled: false },
  },
};

function summarize(results: AxeResults): string {
  return results.violations
    .map(
      (v: AxeResults["violations"][number]) =>
        `[${v.id}] ${v.help} (${v.nodes.length} nodes): ` +
        v.nodes.map((n) => n.target.join(",")).join(" | "),
    )
    .join("\n");
}

// Helper: render into a clean body so axe sees a complete document and run
// the WCAG 2.1 A/AA rule sets. Color-contrast is auto-skipped under jsdom
// (no layout engine); it is covered by the browser-level audit instead.
async function expectNoViolations(ui: ReactNode) {
  const { container } = render(withI18n(ui));
  document.body.innerHTML = "";
  document.body.appendChild(container);
  const results: AxeResults = await axe.run(container, axeOptions);
  expect(results.violations, summarize(results)).toEqual([]);
}

// Portal-aware variant: Radix Dialog renders into document.body via a portal,
// so (a) we must let the portal mount before running axe, and (b) we must
// tear down with unmount() rather than clobbering body.innerHTML (which races
// with Radix's own portal cleanup and throws NotFoundError).
async function expectNoViolationsPortal(ui: ReactNode) {
  const rendered = render(withI18n(ui));
  // Let Radix mount the portal content into body.
  await new Promise((r) => setTimeout(r, 0));
  const results: AxeResults = await axe.run(document.body, axeOptions);
  expect(results.violations, summarize(results)).toEqual([]);
  rendered.unmount();
}

const me: Participant = {
  id: "p1",
  name: "alice",
  kind: "human",
  createdAt: Date.now(),
};
const members: Participant[] = [
  me,
  { id: "p2", name: "bot", kind: "agent", createdAt: Date.now() },
];

const messages: Message[] = [
  {
    id: "m1",
    participantId: "p1",
    authorName: "alice",
    authorKind: "human",
    content: "hello world",
    createdAt: Date.now(),
  },
  {
    id: "m2",
    participantId: "p2",
    authorName: "bot",
    authorKind: "agent",
    content: "hi @alice",
    createdAt: Date.now(),
  },
];

describe("a11y (axe-core, WCAG 2.1 AA)", () => {
  it("Composer has no violations", async () => {
    await expectNoViolations(<Composer onSend={async () => {}} disabled={false} />);
  });

  it("Composer has no violations when disabled", async () => {
    await expectNoViolations(<Composer onSend={async () => {}} disabled />);
  });

  it("Roster has no violations", async () => {
    await expectNoViolations(<Roster members={members} selfId={me.id} />);
  });

  it("Topbar has no violations", async () => {
    await expectNoViolations(
      <Topbar
        meName="alice"
        status="connected"
        members={members}
        selfId={me.id}
        key_={TEST_KEY}
        onSignOutRequest={() => {}}
      />,
    );
  });

  it("MessageList has no violations (with messages)", async () => {
    await expectNoViolations(
      <MessageList messages={messages} me={me} members={members} status="connected" />,
    );
  });

  it("MessageList has no violations (empty state)", async () => {
    await expectNoViolations(
      <MessageList messages={[]} me={me} members={members} status="connected" />,
    );
  });

  it("MessageList has no violations (connection lost banner)", async () => {
    await expectNoViolations(
      <MessageList messages={messages} me={me} members={members} status="lost" />,
    );
  });

  it("AuthDialog has no violations", async () => {
    await expectNoViolationsPortal(
      <AuthDialog open onCreated={() => {}} onAuthed={() => {}} />,
    );
  });

  it("KeyRevealDialog has no violations", async () => {
    await expectNoViolationsPortal(
      <KeyRevealDialog open key_={TEST_KEY} onSaved={() => {}} />,
    );
  });

  it("SignOutConfirmDialog has no violations", async () => {
    await expectNoViolationsPortal(
      <SignOutConfirmDialog
        open
        onOpenChange={() => {}}
        key_={TEST_KEY}
        onConfirm={() => {}}
      />,
    );
  });

  it("SignOutConfirmDialog has no violations when key is null", async () => {
    await expectNoViolationsPortal(
      <SignOutConfirmDialog
        open
        onOpenChange={() => {}}
        key_={null}
        onConfirm={() => {}}
      />,
    );
  });

  it("ViewKeyDialog has no violations (closed trigger)", async () => {
    await expectNoViolations(<ViewKeyDialog key_={TEST_KEY} />);
  });

  it("MobileRoster trigger meets the mobile tap-target minimum (44px)", async () => {
    const { container } = render(
      withI18n(<MobileRoster members={members} selfId={me.id} onlineCount={members.length} />),
    );
    const trigger = container.querySelector("button");
    expect(trigger).toBeTruthy();
    // The .tap-target utility enforces min-h/min-w 44px on touch viewports.
    // jsdom has no layout engine, so assert the class as a regression guard.
    expect(trigger?.className).toContain("tap-target");
  });

  it("Topbar sign-out button meets the mobile tap-target minimum (44px)", async () => {
    const { container } = render(
      withI18n(
        <Topbar
          meName="alice"
          status="connected"
          members={members}
          selfId={me.id}
          key_={TEST_KEY}
          onSignOutRequest={() => {}}
        />,
      ),
    );
    // Locate the sign-out button by its stable testid (the visible/aria text is
    // now language-dependent, so we don't key off a localized string).
    const signOut = container.querySelector<HTMLButtonElement>(
      '[data-testid="sign-out-button"]',
    );
    expect(signOut).toBeTruthy();
    expect(signOut?.className).toContain("tap-target");
  });

  it("Topbar view-key button has an accessible name and tap-target sizing", async () => {
    const { container } = render(
      withI18n(
        <Topbar
          meName="alice"
          status="connected"
          members={members}
          selfId={me.id}
          key_={TEST_KEY}
          onSignOutRequest={() => {}}
        />,
      ),
    );
    // The view-key trigger carries a stable testid; its accessible name is
    // localized (zh here) and asserted implicitly via axe in the ViewKey test.
    const viewKey = container.querySelector<HTMLButtonElement>(
      '[data-testid="view-key-trigger"]',
    );
    expect(viewKey).toBeTruthy();
    expect(viewKey?.className).toContain("tap-target");
  });
});
