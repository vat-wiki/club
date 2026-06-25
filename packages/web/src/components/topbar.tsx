import { LogOut, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileRoster } from "@/components/mobile-roster";
import { cn } from "@/lib/utils";
import type { Participant } from "@club/shared";

type Status = "connecting" | "connected" | "lost";

const statusColor: Record<Status, string> = {
  connected: "bg-agent",
  connecting: "bg-human",
  lost: "bg-destructive",
};
const statusLabel: Record<Status, string> = {
  connected: "connected",
  connecting: "connecting",
  lost: "reconnecting",
};

export function Topbar({
  meName,
  status,
  members,
  selfId,
  onSignOut,
}: {
  meName: string | null;
  status: Status;
  members: Participant[];
  selfId?: string;
  onSignOut: () => void;
}) {
  return (
    <header className="flex flex-none items-center gap-3 border-b border-border bg-gradient-to-b from-card to-background px-4 py-3">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-lg font-semibold tracking-tight">
          club<span className="text-agent">.</span>
        </span>
        <span className="rounded-full border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground">
          #general
        </span>
      </div>

      <div className="flex-1" />

      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        <Radio className="h-3.5 w-3.5" />
        <span className={cn("h-2 w-2 rounded-full", statusColor[status])} />
        {statusLabel[status]}
      </span>

      {/* Mobile-only roster trigger + sheet (hidden on >= md where the aside shows) */}
      <MobileRoster members={members} selfId={selfId} onlineCount={members.length} />

      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={onSignOut}
        aria-label={`sign out (${meName ?? "switch identity"})`}
        title="switch identity"
      >
        <span className="max-w-[10ch] truncate font-mono text-xs">{meName ?? "switch"}</span>
        <LogOut className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </header>
  );
}