import { Users } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { RosterSections } from "@/components/roster";
import { ViewKeyDialog } from "@/components/view-key-dialog";
import { useT } from "@/lib/i18n";
import type { Participant } from "@club/shared";

// Mobile-only roster: on small screens the desktop aside is hidden, so this
// trigger in the topbar opens a right-side sheet with the same sections.
// When `open`/`onOpenChange` are provided, the component renders without its
// own trigger button (used by the mobile topbar menu).
export function MobileRoster({
  members,
  selfId,
  onlineIds,
  onlineCount,
  key_,
  open,
  onOpenChange,
}: {
  members: Participant[];
  selfId?: string;
  onlineIds?: Set<string>;
  onlineCount: number;
  key_: string | null;
  /** When provided, the component is controlled externally (no trigger button). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useT();

  const dialogContent = (
    <DialogContent
      showClose
      closeLabel={t("dialog.close")}
      className="left-auto right-0 top-0 h-[100dvh] max-h-full w-[80vw] max-w-[320px] translate-x-0 translate-y-0 rounded-none rounded-l-lg border-l border-border p-0 data-[state=open]:zoom-in-100 data-[state=open]:slide-in-from-right-full data-[state=closed]:zoom-out-100 data-[state=closed]:slide-out-to-right-full sm:rounded-l-lg"
    >
      <DialogTitle className="sr-only">{t("roster.mobile.title")}</DialogTitle>
      <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] scrollbar-thin">
        <h2 className="font-display text-sm font-semibold tracking-tight">
          {t("roster.mobile.title")}<span className="text-agent">.</span>
        </h2>
        <ViewKeyDialog key_={key_} triggerLabel={t("viewKey.open")} />
        <RosterSections members={members} selfId={selfId} onlineIds={onlineIds} />
      </div>
    </DialogContent>
  );

  // Controlled mode: no trigger button, driven by the parent menu.
  if (onOpenChange !== undefined) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        {dialogContent}
      </Dialog>
    );
  }

  // Default mode: trigger button opens the roster (used when not in the menu).
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={t("roster.mobile.aria", { count: onlineCount })}
          className="tap-target inline-flex items-center gap-1.5 rounded-md border border-border bg-transparent px-2.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:hidden"
        >
          <Users className="h-3.5 w-3.5" aria-hidden />
          <span>{onlineCount}</span>
        </button>
      </DialogTrigger>
      {dialogContent}
    </Dialog>
  );
}
