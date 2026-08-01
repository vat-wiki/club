import { MobileNavSheet } from "@/components/mobile-nav-sheet";
import type { ChannelUnread } from "@/hooks/use-channels";
import { useT } from "@/lib/i18n";
import { Settings } from "lucide-react";

import type { Channel,Participant } from "@club/shared";

function ChannelBadge({ channel }: { channel: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground"
    >
      <span className="text-muted-foreground/60">#</span>
      <span className="max-w-[10ch] truncate">{channel}</span>
    </span>
  );
}

export function Topbar({
  members,
  selfId,
  onlineIds,
  currentChannel,
  channels,
  unread,
  onSelectChannel,
  onCreateChannel,
  onOpenSettings,
}: {
  members: Participant[];
  selfId?: string;
  onlineIds?: Set<string>;
  currentChannel: string;
  channels: Channel[];
  unread: Record<string, ChannelUnread>;
  onSelectChannel: (slug: string) => void;
  onCreateChannel: (name: string) => Promise<void>;
  /** Opens the full-screen Settings overlay. */
  onOpenSettings: () => void;
}) {
  const t = useT();

  return (
    <header className="flex flex-none items-center gap-2 overflow-hidden border-b border-border bg-chrome px-3 py-2.5 sm:gap-3 sm:px-4">
      <div className="flex items-baseline">
        <span className="font-display text-xl font-semibold tracking-tight">
          club<span className="text-agent animate-brand-pulse">.</span>
        </span>
      </div>

      {/* Current channel - static label on every breakpoint. Switching channels
          is done from the mobile nav sheet (hamburger) or the desktop sidebar. */}
      <ChannelBadge channel={currentChannel} />

      <div className="flex-1" />

      {/* Mobile: a single hamburger opens a unified nav sheet
          (channels / members / settings). */}
      <MobileNavSheet
        members={members}
        selfId={selfId}
        onlineIds={onlineIds}
        channels={channels}
        currentChannel={currentChannel}
        unread={unread}
        onSelectChannel={onSelectChannel}
        onCreateChannel={onCreateChannel}
        onOpenSettings={onOpenSettings}
      />

      {/* Desktop: a single gear opens Settings. The sidebar already shows
          channels + members persistently, so no nav sheet is needed here. */}
      <button
        type="button"
        onClick={onOpenSettings}
        aria-label={t("settings.open.aria")}
        title={t("settings.title")}
        data-testid="settings-trigger"
        className="tap-target hidden items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:inline-flex"
      >
        <Settings className="h-4 w-4" aria-hidden />
      </button>
    </header>
  );
}
