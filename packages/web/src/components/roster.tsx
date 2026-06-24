import type { Participant } from "@club/shared";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";

function Row({ p, self }: { p: Participant; self: boolean }) {
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 text-sm">
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
      <h2 className="px-4 pb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
        {title}
      </h2>
      {list.map((p) => (
        <Row key={p.id} p={p} self={p.id === selfId} />
      ))}
    </div>
  );
}

export function Roster({ members, selfId }: { members: Participant[]; selfId?: string }) {
  const humans = members.filter((m) => m.kind === "human");
  const agents = members.filter((m) => m.kind === "agent");
  return (
    <aside className="hidden w-56 flex-none flex-col gap-4 overflow-y-auto border-r border-border bg-card p-3 scrollbar-thin md:flex">
      <Section title="humans" list={humans} selfId={selfId} />
      {humans.length > 0 && agents.length > 0 && <Separator />}
      <Section title="agents" list={agents} selfId={selfId} />
    </aside>
  );
}