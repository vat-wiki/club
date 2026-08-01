import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { MoreVertical, Radio, Settings, Users } from "lucide-react";
import { useState } from "react";

import type { Participant } from "@club/shared";

import type { Status as TopbarStatus } from "./topbar";

// Re-export the Status type for callers that need it.
export type { Status } from "./topbar";

const statusColor: Record<TopbarStatus, string> = {
  connected: "bg-agent",
  connecting: "bg-human",
  lost: "bg-destructive",
};

const statusKey: Record<TopbarStatus, string> = {
  connected: "status.connected",
  connecting: "status.connecting",
  lost: "status.reconnecting",
};

type Props = {
  status: TopbarStatus;
  members: Participant[];
  onlineIds?: Set<string>;
  onOpenRoster: () => void;
  onOpenSettings: () => void;
};

// Mobile "more" menu: a bottom sheet with connection status, the roster, and
// Settings. Language, view-key, and sign-out used to live here too - they've all
// moved into the Settings overlay, so this menu is just the two navigation
// shortcuts plus the live status dot.
export function MobileTopbarMenu({
  status,
  members,
  onlineIds,
  onOpenRoster,
  onOpenSettings,
}: Props) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);

  const rosterCount = onlineIds?.size ?? members.length;

  const menu = (
    <div className="flex flex-col gap-1 px-2">
      {/* Connection status */}
      <div className="flex items-center gap-2 px-2 py-2.5">
        <Radio className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span
          className={cn(
            "h-2.5 w-2.5 rounded-full transition-colors duration-slow",
            statusColor[status],
          )}
          aria-hidden
        />
        <span className="flex-1 text-sm text-muted-foreground">{t(statusKey[status])}</span>
      </div>

      <div className="h-px bg-border" />

      {/* Roster */}
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2.5 text-sm transition-colors hover:bg-accent/70"
        onClick={() => {
          setMenuOpen(false);
          onOpenRoster();
        }}
      >
        <span className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="text-muted-foreground">{t("topbar.menu.roster")}</span>
        </span>
        <span className="font-mono text-xs text-muted-foreground">{rosterCount}</span>
      </button>

      {/* Settings */}
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2.5 text-sm transition-colors hover:bg-accent/70"
        onClick={() => {
          setMenuOpen(false);
          onOpenSettings();
        }}
        aria-label={t("settings.title")}
      >
        <span className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="text-muted-foreground">{t("settings.title")}</span>
        </span>
      </button>
    </div>
  );

  return (
    <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={t("topbar.menu.aria")}
          aria-haspopup="dialog"
          data-testid="mobile-menu-trigger"
          className="tap-target inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
        >
          <MoreVertical className="h-4 w-4" aria-hidden />
        </button>
      </DialogTrigger>
      <DialogContent
        showClose
        closeLabel={t("dialog.close")}
        className="left-0 right-0 top-auto bottom-0 h-auto max-h-[80dvh] w-full translate-x-0 translate-y-0 rounded-none rounded-t-lg border-t border-border p-0 data-[state=open]:slide-in-from-bottom-full data-[state=closed]:slide-out-to-bottom-full"
      >
        <DialogTitle className="sr-only">{t("topbar.menu.title")}</DialogTitle>
        <div className="flex flex-col gap-4 overflow-y-auto px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <h2 className="font-display text-sm font-semibold tracking-tight">
            {t("topbar.menu.title")}<span className="text-agent">.</span>
          </h2>
          {menu}
        </div>
      </DialogContent>
    </Dialog>
  );
}
