import { Users } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
      <button
        type="button"
        aria-label={`members — ${onlineCount} online`}
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-transparent px-2.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:hidden"
      >
        <Users className="h-3.5 w-3.5" aria-hidden />
        <span>{onlineCount}</span>
      </button>
      <DialogContent
        showClose
        className="left-auto right-0 top-0 h-full max-h-full w-[80vw] max-w-[320px] translate-x-0 translate-y-0 rounded-none rounded-l-lg border-l border-border p-0 sm:rounded-l-lg"
      >
        {/* Visually-hidden title keeps the dialog accessible; the visible
            heading below is for sighted users. */}
        <DialogTitle className="sr-only">members</DialogTitle>
        <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 scrollbar-thin">
          <h2 className="font-display text-sm font-semibold tracking-tight">
            members<span className="text-agent">.</span>
          </h2>
          <RosterSections members={members} selfId={selfId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
