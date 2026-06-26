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
    <header className="flex flex-none items-center gap-3 border-b border-border bg-chrome px-4 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-xl font-semibold tracking-tight">
          club<span className="text-agent animate-brand-pulse">.</span>
        </span>
        <span className="rounded-full border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground">
          #general
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
        <span className={cn("h-2 w-2 rounded-full transition-colors duration-slow", statusColor[status])} aria-hidden />
        <span className="sr-only sm:not-sr-only">{statusLabel[status]}</span>
      </span>

      <span aria-hidden className="h-4 w-px flex-none bg-border" />

      {/* Mobile-only roster trigger + sheet (hidden on >= md where the aside shows) */}
      <MobileRoster members={members} selfId={selfId} onlineCount={members.length} />

      <Button
        variant="outline"
        className="tap-target gap-1.5 px-2.5 sm:px-3"
        onClick={onSignOut}
        aria-label={`sign out (${meName ?? "switch identity"})`}
        title="sign out"
      >
        <span className="max-w-[6ch] truncate font-mono text-xs sm:max-w-[10ch]">{meName ?? "switch"}</span>
        {/* Always-visible label so the action is discoverable without hover
            (the LogOut icon alone is ambiguous). Muted + tiny to stay quiet
            visually; aria-hidden because the button's accessible name already
            spells it out via aria-label. */}
        <span aria-hidden className="hidden font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:inline">
          sign out
        </span>
        <LogOut className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </header>
  );
}