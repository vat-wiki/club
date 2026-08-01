import { ChannelList } from "@/components/channel-list";
import { RosterSections } from "@/components/roster";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import type { ChannelUnread } from "@/hooks/use-channels";
import { useT } from "@/lib/i18n";
import { Menu, Settings } from "lucide-react";
import { useState } from "react";

import type { Channel,Participant } from "@club/shared";

// Mobile navigation: on small screens the desktop sidebar (channels + members)
// is hidden, so this single hamburger in the topbar opens a bottom sheet with
// the CHANNELS list, the MEMBERS roster, and a Settings entry. It's the one
// button that consolidates everything that used to be split across a channel
// badge, a "more" menu, and a separate roster sheet.
//
// Selecting a channel or tapping Settings closes the sheet first so focus
// returns to the chat / lands on the Settings overlay.
export function MobileNavSheet({
  members,
  selfId,
  onlineIds,
  channels,
  currentChannel,
  unread,
  onSelectChannel,
  onCreateChannel,
  onOpenSettings,
}: {
  members: Participant[];
  selfId?: string;
  onlineIds?: Set<string>;
  channels: Channel[];
  currentChannel: string;
  unread: Record<string, ChannelUnread>;
  onSelectChannel: (slug: string) => void;
  onCreateChannel: (name: string) => Promise<void>;
  onOpenSettings: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const onlineCount = onlineIds?.size ?? members.length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={t("topbar.menu.aria")}
          aria-haspopup="dialog"
          data-testid="mobile-menu-trigger"
          className="tap-target inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
        >
          <Menu className="h-4 w-4" aria-hidden />
        </button>
      </DialogTrigger>
      <DialogContent
        showClose
        closeLabel={t("dialog.close")}
        // Bottom sheet: slides up, full-width, rounded top only.
        className="bottom-0 left-0 top-auto h-auto max-h-[85dvh] w-full max-w-none translate-x-0 translate-y-0 rounded-none rounded-t-lg border-t border-border p-0 data-[state=open]:slide-in-from-bottom-full data-[state=closed]:slide-out-to-bottom-full"
      >
        <DialogTitle className="sr-only">{t("topbar.menu.title")}</DialogTitle>
        <div className="flex flex-col gap-4 overflow-y-auto p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] scrollbar-thin">
          <h2 className="font-display text-sm font-semibold tracking-tight">
            {t("topbar.menu.title")}<span className="text-agent">.</span>
          </h2>

          <ChannelList
            channels={channels}
            currentChannel={currentChannel}
            unread={unread}
            mobile
            onSelect={(slug) => {
              onSelectChannel(slug);
              setOpen(false);
            }}
            onCreate={async (name) => {
              await onCreateChannel(name);
              setOpen(false);
            }}
          />

          <Separator />

          <section aria-label={t("roster.onlineLabel")}>
            <h2 className="flex items-center gap-2 px-4 pb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/85">
              {t("roster.onlineLabel")}
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">{onlineCount}</span>
            </h2>
            <RosterSections members={members} selfId={selfId} onlineIds={onlineIds} />
          </section>

          <Separator />

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
            aria-label={t("settings.title")}
            data-testid="mobile-nav-settings"
            className="flex min-h-[44px] w-full items-center gap-2 rounded-md px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
          >
            <Settings className="h-4 w-4" aria-hidden />
            {t("settings.title")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
