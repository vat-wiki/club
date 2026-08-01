import type { MentionToast } from "@/hooks/use-channels";
import { withI18n } from "@/test/i18n-wrap";
import { render } from "@testing-library/react";
import type { AxeResults, RunOptions } from "axe-core";
import * as axe from "axe-core";
import type { ReactNode } from "react";
import { describe, expect,it } from "vitest";

import type { Message, Participant } from "@club/shared";

import { AuthDialog } from "./auth-dialog";
import { BootScreen } from "./boot-screen";
import { ChannelList } from "./channel-list";
import { Composer } from "./composer";
import { MentionToasts } from "./mention-toast";
import { MessageList } from "./message-list";
import { MobileNavSheet } from "./mobile-nav-sheet";
import { RecoverDialog } from "./recover-dialog";
import { Roster } from "./roster";
import { SettingsDialog } from "./settings-dialog";
import { SignOutConfirmDialog } from "./sign-out-confirm-dialog";
import { Topbar } from "./topbar";
import { TypingIndicator } from "./typing-indicator";
import { ConfirmDialog } from "./ui/confirm-dialog";

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
  bio: "",
  createdAt: Date.now(),
};
const members: Participant[] = [
  me,
  { id: "p2", name: "bot", bio: "", createdAt: Date.now() },
];

const messages: Message[] = [
  {
    id: "m1",
    participantId: "p1",
    authorName: "alice",
    content: "hello world",
    createdAt: Date.now(),
    channel: "general",
  },
  {
    id: "m2",
    participantId: "p2",
    authorName: "bot",
    content: "hi @alice",
    createdAt: Date.now(),
    channel: "general",
  },
];

// A couple of channels + a no-op switch/create so the channel-aware components render
// fully under axe without dragging in real data fetching.
const channels = [
  { id: "r1", slug: "general", createdAt: 0, lastActivityAt: Date.now(), displayName: null },
  { id: "r2", slug: "deploy-debug", createdAt: 0, lastActivityAt: Date.now(), displayName: null },
];
const noop = async () => {};
const channelNav = {
  channels,
  currentChannel: "general",
  unread: {},
  onSelectChannel: () => {},
  onCreateChannel: noop,
};

describe("a11y (axe-core, WCAG 2.1 AA)", () => {
  it("Composer has no violations", async () => {
    await expectNoViolations(<Composer onSend={async () => {}} disabled={false} />);
  });

  it("Composer has no violations when disabled", async () => {
    await expectNoViolations(<Composer onSend={async () => {}} disabled />);
  });

  it("Roster has no violations", async () => {
    await expectNoViolations(<Roster members={members} selfId={me.id} {...channelNav} />);
  });

  it("Topbar has no violations", async () => {
    await expectNoViolations(
      <Topbar
        members={members}
        selfId={me.id}
        {...channelNav}
        onOpenSettings={() => {}}
      />,
    );
  });

  it("MessageList has no violations (with messages)", async () => {
    await expectNoViolations(
      <MessageList messages={messages} me={me} members={members} status="connected" channel="general" />,
    );
  });

  it("ChannelList has no violations", async () => {
    await expectNoViolations(
      <ChannelList
        channels={channels}
        currentChannel="general"
        unread={{ "deploy-debug": { count: 2, mention: true } }}
        onSelect={() => {}}
        onCreate={async () => {}}
      />,
    );
  });

  it("MentionToasts have no violations", async () => {
    const toasts: MentionToast[] = [
      { id: "t1", messageId: "m1", channel: "deploy-debug", authorName: "claude", content: "hey @alice" },
    ];
    await expectNoViolations(
      <MentionToasts toasts={toasts} onActivate={() => {}} onDismiss={() => {}} />,
    );
  });

  it("MessageList has no violations (with image attachments)", async () => {
    const withImages: Message[] = [
      {
        ...messages[0],
        content: "a screenshot",
        attachments: [
          {
            id: "a1",
            url: "/files/a1",
            mime: "image/png",
            width: 100,
            height: 75,
            size: 1234,
          },
          {
            id: "a2",
            url: "/files/a2",
            mime: "image/jpeg",
            width: 100,
            height: 75,
            size: 1234,
          },
        ],
      },
    ];
    await expectNoViolations(
      <MessageList messages={withImages} me={me} members={members} status="connected" />,
    );
  });

  it("MessageList has no violations (pure-image message, empty text)", async () => {
    const pureImage: Message[] = [
      {
        ...messages[0],
        content: "",
        attachments: [
          { id: "a1", url: "/files/a1", mime: "image/png", width: 100, height: 75, size: 1234 },
        ],
      },
    ];
    await expectNoViolations(
      <MessageList messages={pureImage} me={me} members={members} status="connected" />,
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

  it("BootScreen (error state) has no violations", async () => {
    // The /me-failure retry screen (P0-2): role=alert + retry/reload buttons.
    await expectNoViolations(
      <BootScreen status="error" retryNonce={0} onRetry={() => {}} onSwitch={() => {}} />,
    );
  });

  it("BootScreen (loading state) has no violations", async () => {
    await expectNoViolations(
      <BootScreen status="loading" retryNonce={0} onRetry={() => {}} onSwitch={() => {}} />,
    );
  });

  it("BootScreen (rejected state - wrong key) has no violations", async () => {
    // 401/403 on /me: non-retryable, primary CTA is switching keys.
    await expectNoViolations(
      <BootScreen status="rejected" retryNonce={0} onRetry={() => {}} onSwitch={() => {}} />,
    );
  });

  it("TypingIndicator has no violations (with thinking agents)", async () => {
    // The agent "thinking" placeholder (P1-5). role=status carries the label.
    await expectNoViolations(
      <TypingIndicator
        agents={[
          { id: "1", name: "rex" },
          { id: "2", name: "ana" },
        ]}
      />,
    );
  });

  it("TypingIndicator renders nothing (no a11y footprint) when empty", async () => {
    const { container } = render(withI18n(<TypingIndicator agents={[]} />));
    expect(container.firstChild).toBeNull();
  });

  it("RecoverDialog has no violations", async () => {
    await expectNoViolationsPortal(
      <RecoverDialog
        open
        onOpenChange={() => {}}
        onRecovered={() => {}}
      />,
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

  it("SettingsDialog has no violations (open)", async () => {
    await expectNoViolationsPortal(
      <SettingsDialog
        open
        onOpenChange={() => {}}
        me={me}
        members={members}
        selfId={me.id}
        channels={channels}
        key_={TEST_KEY}
        onSaveMyBio={async () => {}}
        onSaveMemberBio={async () => {}}
        onSignOutRequest={() => {}}
        onRenameChannel={async () => {}}
        onDeleteChannel={async () => {}}
        onKickMember={async () => {}}
      />,
    );
  });

  it("ConfirmDialog has no violations (open)", async () => {
    await expectNoViolationsPortal(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete channel"
        description="Delete #deploy-debug? Its messages will be removed too."
        confirmLabel="Delete"
        onConfirm={() => {}}
      />,
    );
  });

  it("MobileNavSheet trigger meets the mobile tap-target minimum (44px)", async () => {
    const { container } = render(
      withI18n(
        <MobileNavSheet
          members={members}
          selfId={me.id}
          {...channelNav}
          onOpenSettings={() => {}}
        />,
      ),
    );
    const trigger = container.querySelector('[data-testid="mobile-menu-trigger"]');
    expect(trigger).toBeTruthy();
    // The .tap-target utility enforces min-h/min-w 44px on touch viewports.
    // jsdom has no layout engine, so assert the class as a regression guard.
    expect(trigger?.className).toContain("tap-target");
  });

  it("Topbar settings gear meets the mobile tap-target minimum (44px)", async () => {
    const { container } = render(
      withI18n(
        <Topbar
          members={members}
          selfId={me.id}
          {...channelNav}
          onOpenSettings={() => {}}
        />,
      ),
    );
    // The gear is the single management entry point on desktop (lang/key/sign-out
    // moved behind it). Assert it's present and touch-sized.
    const gear = container.querySelector<HTMLButtonElement>(
      '[data-testid="settings-trigger"]',
    );
    expect(gear).toBeTruthy();
    expect(gear?.className).toContain("tap-target");
  });
});
