import type { Participant } from "@club/shared";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";

function Row({ p, self }: { p: Participant; self: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-md px-4 py-1.5 text-sm transition-colors hover:bg-accent/70">
      <span
        className={cn(
          "h-2 w-2 flex-none rounded-full",
          p.kind === "agent" ? "bg-agent animate-agent-pulse" : "bg-human",
        )}
      />
      <span className={cn("truncate", self ? "text-foreground" : "text-muted-foreground")}>
        {p.name}
        {self && <span className="ml-1.5 align-middle font-mono text-[10px] text-muted-foreground">you</span>}
      </span>
    </div>
  );
}

function Section({ title, list, selfId }: { title: string; list: Participant[]; selfId?: string }) {
  if (list.length === 0) return null;
  return (
    <div className="space-y-1">
      <h2 className="px-4 pb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/85">
        {title}
      </h2>
      {list.map((p) => (
        <Row key={p.id} p={p} self={p.id === selfId} />
      ))}
    </div>
  );
}

// Shared roster body — rendered inside the desktop aside and the mobile sheet.
export function RosterSections({ members, selfId }: { members: Participant[]; selfId?: string }) {
  const humans = members.filter((m) => m.kind === "human");
  const agents = members.filter((m) => m.kind === "agent");
  return (
    <>
      <Section title="humans" list={humans} selfId={selfId} />
      {humans.length > 0 && agents.length > 0 && <Separator />}
      <Section title="agents" list={agents} selfId={selfId} />
    </>
  );
}

export function Roster({ members, selfId }: { members: Participant[]; selfId?: string }) {
  return (
    <aside
      aria-label="Members online"
      // Keyboard-focusable scroll region (WCAG 2.1.1 + axe
      // `scrollable-region-focusable`): otherwise keyboard users can't focus
      // the member list to arrow-scroll it independently.
      tabIndex={0}
      className="hidden w-56 flex-none flex-col gap-4 overflow-y-auto border-r border-border bg-chrome p-3 scrollbar-thin outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/40 md:flex"
    >
      <RosterSections members={members} selfId={selfId} />
    </aside>
  );
}