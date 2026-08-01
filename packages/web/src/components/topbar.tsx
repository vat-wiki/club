import { LanguageSwitcher } from "@/components/language-switcher";
import { MobileChannelSheet } from "@/components/mobile-channel-sheet";
import { MobileRoster } from "@/components/mobile-roster";
import { MobileTopbarMenu } from "@/components/mobile-topbar-menu";
import { Button } from "@/components/ui/button";
import { ViewKeyDialog } from "@/components/view-key-dialog";
import type { ChannelUnread } from "@/hooks/use-channels";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ChevronDown, LogOut, Radio, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

import type { Channel,Participant } from "@club/shared";

export type Status = "connecting" | "connected" | "lost";

const statusColor: Record<Status, string> = {
  connected: "bg-agent",
  connecting: "bg-human",
  lost: "bg-destructive",
};
const statusKey: Record<Status, string> = {
  connected: "status.connected",
  connecting: "status.connecting",
  lost: "status.reconnecting",
};

function ChannelBadge({ channel, clickable }: { channel: string; clickable?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-xs",
        clickable ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <span className="text-muted-foreground/60">#</span>
      <span className="max-w-[10ch] truncate">{channel}</span>
      {clickable && <ChevronDown aria-hidden className="h-3 w-3 text-muted-foreground/70" />}
    </span>
  );
}

export function Topbar({
  meName,
  status,
  members,
  selfId,
  key_,
  onlineIds,
  currentChannel,
  channels,
  unread,
  onSelectChannel,
  onCreateChannel,
  onSignOutRequest,
  onEditProfile,
  onRotateKeyRequest,
  onDeleteAccountRequest,
}: {
  meName: string | null;
  status: Status;
  members: Participant[];
  selfId?: string;
  onlineIds?: Set<string>;
  key_: string | null;
  currentChannel: string;
  channels: Channel[];
  unread: Record<string, ChannelUnread>;
  onSelectChannel: (slug: string) => void;
  onCreateChannel: (name: string) => Promise<void>;
  onSignOutRequest: () => void;
  /** Opens the bio editor for the self row (passed through to the mobile roster). */
  onEditProfile?: () => void;
  /** Open the rotate-key confirm dialog (account settings). */
  onRotateKeyRequest?: () => void;
  /** Open the delete-account confirm dialog (account settings). */
  onDeleteAccountRequest?: () => void;
}) {
  const t = useT();
  const [rosterOpen, setRosterOpen] = useState(false);

  return (
    <header className="flex flex-none items-center gap-2 overflow-hidden border-b border-border bg-chrome px-3 py-2.5 sm:gap-3 sm:px-4">
      <div className="flex items-baseline">
        <span className="font-display text-xl font-semibold tracking-tight">
          club<span className="text-agent animate-brand-pulse">.</span>
        </span>
      </div>

      <div className="flex flex-none items-center">
        <div className="md:hidden">
          <MobileChannelSheet
            trigger={
              <button
                type="button"
                aria-label={t("channels.switchTo", { channel: currentChannel })}
                className="tap-target rounded-full outline-none transition-colors hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChannelBadge channel={currentChannel} clickable />
              </button>
            }
            channels={channels}
            currentChannel={currentChannel}
            unread={unread}
            onSelect={onSelectChannel}
            onCreate={onCreateChannel}
          />
        </div>
        <span className="hidden md:inline-flex">
          <ChannelBadge channel={currentChannel} />
        </span>
      </div>

      <div className="flex-1" />

      {/* Mobile: all top-right icons collapsed into a single "more" menu button */}
      <MobileTopbarMenu
        status={status}
        members={members}
        onlineIds={onlineIds}
        key_={key_}
        onSignOutRequest={onSignOutRequest}
        onOpenRoster={() => setRosterOpen(true)}
        onRotateKeyRequest={onRotateKeyRequest}
        onDeleteAccountRequest={onDeleteAccountRequest}
      />

      {/* Mobile roster sheet (triggered from the menu, not a topbar button) */}
      <MobileRoster
        members={members}
        selfId={selfId}
        onlineIds={onlineIds}
        onlineCount={onlineIds?.size ?? members.length}
        key_={key_}
        open={rosterOpen}
        onOpenChange={setRosterOpen}
        onEditProfile={onEditProfile}
      />

      {/* Desktop: full set of top-right icons (hidden on mobile) */}
      <span
        className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground md:inline-flex"
        role="status"
        aria-live="polite"
      >
        <Radio className="h-3.5 w-3.5" aria-hidden />
        <span className={cn("h-2.5 w-2.5 rounded-full transition-colors duration-slow", statusColor[status])} aria-hidden />
        <span className={cn(status === "connecting" ? "" : "sr-only", "sm:not-sr-only")}>{t(statusKey[status])}</span>
      </span>

      <span aria-hidden className="h-4 w-px flex-none bg-border md:inline-flex" />

      <LanguageSwitcher />

      <ViewKeyDialog key_={key_} />

      {/* Desktop: rotate key + delete account (hidden on mobile - the mobile
          menu has its own entries). Compact icon buttons matching view-key. */}
      {onRotateKeyRequest && (
        <button
          type="button"
          onClick={onRotateKeyRequest}
          aria-label={t("rotateKey.open")}
          title={t("rotateKey.open")}
          className="tap-target hidden items-center justify-center rounded-md border border-border bg-transparent px-2 text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:inline-flex"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
      {onDeleteAccountRequest && (
        <button
          type="button"
          onClick={onDeleteAccountRequest}
          aria-label={t("deleteAccount.open")}
          title={t("deleteAccount.open")}
          className="tap-target hidden items-center justify-center rounded-md border border-border bg-transparent px-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:inline-flex"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}

      <Button
        variant="outline"
        className="tap-target hidden gap-1.5 px-2.5 active:bg-accent md:inline-flex md:px-3"
        onClick={onSignOutRequest}
        aria-label={t("topbar.signOut.aria", {
          name: meName ?? t("topbar.signOut.switchIdentity"),
        })}
        title={t("topbar.signOut.title")}
        data-testid="sign-out-button"
      >
        <span className="max-w-[6ch] truncate font-mono text-xs sm:max-w-[10ch]">
          {meName ?? t("topbar.signOut.short")}
        </span>
        <span aria-hidden className="hidden font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:inline">
          {t("topbar.signOut.label")}
        </span>
        <LogOut className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </header>
  );
}
