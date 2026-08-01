import { RosterSections } from "@/components/roster";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";
import { Users } from "lucide-react";

import type { Participant } from "@club/shared";

// Mobile-only roster: on small screens the desktop aside is hidden, so the
// topbar menu opens this right-side sheet with the same (read-only) presence
// list. Bio edits and kicks live in Settings; this is just who's here.
//
// Always controlled (open/onOpenChange) - the trigger lives in the mobile
// topbar menu, not in this component.
export function MobileRoster({
  members,
  selfId,
  onlineIds,
  onlineCount,
  open,
  onOpenChange,
}: {
  members: Participant[];
  selfId?: string;
  onlineIds?: Set<string>;
  onlineCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showClose
        closeLabel={t("dialog.close")}
        className="left-auto right-0 top-0 h-[100dvh] max-h-full w-[80vw] max-w-[320px] translate-x-0 translate-y-0 rounded-none rounded-l-lg border-l border-border p-0 data-[state=open]:zoom-in-100 data-[state=open]:slide-in-from-right-full data-[state=closed]:zoom-out-100 data-[state=closed]:slide-out-to-right-full sm:rounded-l-lg"
      >
        <DialogTitle className="sr-only">{t("roster.mobile.title")}</DialogTitle>
        <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] scrollbar-thin">
          <h2 className="flex items-center gap-2 font-display text-sm font-semibold tracking-tight">
            <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
            {t("roster.mobile.title")}
            <span className="text-agent">.</span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">{onlineCount}</span>
          </h2>
          <RosterSections members={members} selfId={selfId} onlineIds={onlineIds} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
