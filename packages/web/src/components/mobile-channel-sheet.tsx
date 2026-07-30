import { ChannelList } from "@/components/channel-list";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { ChannelUnread } from "@/hooks/use-channels";
import { useT } from "@/lib/i18n";
import { type ReactNode,useState } from "react";

import type { Channel } from "@club/shared";

// Mobile channel selector: on small screens the desktop sidebar is hidden, so the
// topbar's channel badge opens this bottom sheet with the CHANNELS list + new-channel
// affordance. Selecting a channel switches focus and closes the sheet.
//
// The trigger (the channel badge) is passed in by the topbar so the badge stays the
// single visual element across breakpoints; this component just owns the sheet.
export function MobileChannelSheet({
  trigger,
  channels,
  currentChannel,
  unread,
  onSelect,
  onCreate,
}: {
  trigger: ReactNode;
  channels: Channel[];
  currentChannel: string;
  unread: Record<string, ChannelUnread>;
  onSelect: (slug: string) => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        showClose
        closeLabel={t("dialog.close")}
        // Bottom sheet on mobile: slides up from the bottom, full-width, rounded
        // top only. Mirrors the mobile-roster sheet手法 but anchored bottom.
        className="bottom-0 left-0 top-auto h-auto max-h-[80dvh] w-full max-w-none translate-x-0 translate-y-0 rounded-none rounded-t-lg border-t border-border p-0 data-[state=open]:slide-in-from-bottom-full data-[state=closed]:slide-out-to-bottom-full sm:rounded-t-lg"
      >
        <DialogTitle className="sr-only">{t("channels.mobile.title")}</DialogTitle>
        <div className="flex flex-col gap-3 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] scrollbar-thin">
          <h2 className="font-display text-sm font-semibold tracking-tight">
            {t("channels.mobile.title")}
            <span className="text-agent">.</span>
          </h2>
          <ChannelList
            channels={channels}
            currentChannel={currentChannel}
            unread={unread}
            mobile
            onSelect={(slug) => {
              onSelect(slug);
              setOpen(false);
            }}
            onCreate={async (name) => {
              await onCreate(name);
              setOpen(false);
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
