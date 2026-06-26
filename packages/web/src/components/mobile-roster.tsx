import { Users } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { RosterSections } from "@/components/roster";
import type { Participant } from "@club/shared";

// Mobile-only roster: on small screens the desktop aside is hidden, so this
// trigger in the topbar opens a right-side sheet with the same sections.
export function MobileRoster({
  members,
  selfId,
  onlineCount,
}: {
  members: Participant[];
  selfId?: string;
  onlineCount: number;
}) {
  return (
    <Dialog>
      {/* DialogTrigger wires open/close state and exposes aria-haspopup/expanded
          on the button. asChild keeps our styling + accessible name. */}
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`成员——${onlineCount} 人在线`}
          className="tap-target inline-flex items-center gap-1.5 rounded-md border border-border bg-transparent px-2.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:hidden"
        >
          <Users className="h-3.5 w-3.5" aria-hidden />
          <span>{onlineCount}</span>
        </button>
      </DialogTrigger>
      <DialogContent
        showClose
        className="left-auto right-0 top-0 h-full max-h-full w-[80vw] max-w-[320px] translate-x-0 translate-y-0 rounded-none rounded-l-lg border-l border-border p-0 data-[state=open]:zoom-in-100 data-[state=open]:slide-in-from-right-full data-[state=closed]:zoom-out-100 data-[state=closed]:slide-out-to-right-full sm:rounded-l-lg"
      >
        {/* Visually-hidden title keeps the dialog accessible; the visible
            heading below is for sighted users. */}
        <DialogTitle className="sr-only">成员</DialogTitle>
        <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 scrollbar-thin">
          <h2 className="font-display text-sm font-semibold tracking-tight">
            成员<span className="text-agent">.</span>
          </h2>
          <RosterSections members={members} selfId={selfId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
