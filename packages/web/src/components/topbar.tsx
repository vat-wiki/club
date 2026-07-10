import { ChevronDown, LogOut, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileRoster } from "@/components/mobile-roster";
import { MobileRoomSheet } from "@/components/mobile-room-sheet";
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
// Status word keys, resolved via t() so they follow the active language.
const statusKey: Record<Status, string> = {
  connected: "status.connected",
  connecting: "status.connecting",
  lost: "status.reconnecting",
};

// The current-room badge shown in the topbar (one of the "triple identifiers"
// of the focused room — sidebar row + topbar badge + composer placeholder).
// On mobile it doubles as the room-sheet trigger; on desktop it's a static
// label (the sidebar carries the full switchable list).
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
  // The current user's login key, read from localStorage. Null when signed
  // out (and the topbar is hidden then anyway). Passed down so the ViewKey
  // dialog and SignOut flow can show/copy it.
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
  // Triggered by the sign-out button; opens the confirmation dialog rather
  // than signing out immediately, so the user has a chance to save the key.
  onSignOutRequest: () => void;
}) {
  const t = useT();
  return (
    <header className="flex flex-none items-center gap-2 overflow-hidden border-b border-border bg-chrome px-3 py-2.5 sm:gap-3 sm:px-4">
      <div className="flex items-baseline">
        <span className="font-display text-xl font-semibold tracking-tight">
          club<span className="text-agent animate-brand-pulse">.</span>
        </span>
      </div>

      {/* Current-room badge — ALWAYS visible across breakpoints (design §7.4),
          since it's a primary nav entry on mobile. On mobile it opens the room
          sheet; on desktop it's a static label (the sidebar lists rooms). */}
      <div className="flex flex-none items-center">
        {/* Mobile: the badge is the sheet trigger (md:hidden). */}
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
        {/* Desktop: static badge (sidebar owns the switchable list). */}
        <span className="hidden md:inline-flex">
          <RoomBadge room={currentRoom} />
        </span>
      </div>

      <div className="flex-1" />

      <span
        className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground"
        // Live connection state: announce changes (e.g. "lost") without
        // stealing focus. role=status is implicitly aria-live=polite.
        role="status"
        aria-live="polite"
      >
        <Radio className="h-3.5 w-3.5" aria-hidden />
        {/* The dot duplicates the visible status word; hide it from AT so the
            state isn't announced twice. Color is never the sole signal. */}
        <span className={cn("h-2.5 w-2.5 rounded-full transition-colors duration-slow", statusColor[status])} aria-hidden />
        {/* "connecting" is the one state worth a visible label on mobile (no
            banner fallback yet), so show it even below sm; the others stay
            icon-only on mobile to keep the crowded topbar quiet. */}
        <span className={cn(status === "connecting" ? "" : "sr-only", "sm:not-sr-only")}>{t(statusKey[status])}</span>
      </span>

      <span aria-hidden className="h-4 w-px flex-none bg-border" />

      {/* Language switcher: persists the choice to localStorage. */}
      <LanguageSwitcher />

      {/* View / copy the current login key. Hidden on the tiniest screens'
          topbar row to avoid crowding; the action is also reachable via the
          sign-out confirmation dialog. md+ keeps it inline. */}
      <ViewKeyDialog key_={key_} />

      {/* Mobile-only roster trigger + sheet (hidden on >= md where the aside shows) */}
      <MobileRoster members={members} selfId={selfId} onlineIds={onlineIds} onlineCount={onlineIds?.size ?? members.length} key_={key_} />

      <Button
        variant="outline"
        className="tap-target gap-1.5 px-2.5 active:bg-accent sm:px-3"
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
        {/* Always-visible label so the action is discoverable without hover
            (the LogOut icon alone is ambiguous). Muted + tiny to stay quiet
            visually; aria-hidden because the button's accessible name already
            spells it out via aria-label. */}
        <span aria-hidden className="hidden font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:inline">
          {t("topbar.signOut.label")}
        </span>
        <LogOut className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </header>
  );
}
