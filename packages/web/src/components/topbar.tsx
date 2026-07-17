import { useState } from "react";
import { ChevronDown, LogOut, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileRoster } from "@/components/mobile-roster";
import { MobileRoomSheet } from "@/components/mobile-room-sheet";
import { MobileTopbarMenu } from "@/components/mobile-topbar-menu";
import { ViewKeyDialog } from "@/components/view-key-dialog";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Participant, Room } from "@club/shared";
import type { RoomUnread } from "@/hooks/use-rooms";

type Status = "connecting" | "connected" | "lost";

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

function RoomBadge({ room, clickable }: { room: string; clickable?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-xs",
        clickable ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <span className="text-muted-foreground/60">#</span>
      <span className="max-w-[10ch] truncate">{room}</span>
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
  currentRoom,
  rooms,
  unread,
  onSelectRoom,
  onCreateRoom,
  onSignOutRequest,
}: {
  meName: string | null;
  status: Status;
  members: Participant[];
  selfId?: string;
  onlineIds?: Set<string>;
  key_: string | null;
  currentRoom: string;
  rooms: Room[];
  unread: Record<string, RoomUnread>;
  onSelectRoom: (slug: string) => void;
  onCreateRoom: (name: string) => Promise<void>;
  onSignOutRequest: () => void;
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
          <MobileRoomSheet
            trigger={
              <button
                type="button"
                aria-label={t("rooms.switchTo", { room: currentRoom })}
                className="tap-target rounded-full outline-none transition-colors hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <RoomBadge room={currentRoom} clickable />
              </button>
            }
            rooms={rooms}
            currentRoom={currentRoom}
            unread={unread}
            onSelect={onSelectRoom}
            onCreate={onCreateRoom}
          />
        </div>
        <span className="hidden md:inline-flex">
          <RoomBadge room={currentRoom} />
        </span>
      </div>

      <div className="flex-1" />

      {/* Mobile: all top-right icons collapsed into a single "more" menu button */}
      <MobileTopbarMenu
        status={status}
        members={members}
        selfId={selfId}
        onlineIds={onlineIds}
        key_={key_}
        onSignOutRequest={onSignOutRequest}
        onOpenRoster={() => setRosterOpen(true)}
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
