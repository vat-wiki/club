import type { Participant, Room } from "@club/shared";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { Avatar } from "@/components/avatar";
import { RoomList } from "@/components/room-list";
import type { RoomUnread } from "@/hooks/use-rooms";

function Row({ p, self, online }: { p: Participant; self: boolean; online: boolean }) {
  const t = useT();
  return (
    <div className="flex min-h-[44px] items-center gap-2 rounded-md px-4 py-1.5 text-sm transition-colors hover:bg-accent/70 active:bg-accent">
      {/* Offline (no live SSE connection) members read as "who's here now" via
          the dimmer avatar; the name keeps a contrast-safe muted color rather
          than an opacity multiplier, which previously dropped it below AA
          (opacity-50 on muted-foreground → 2.87:1). */}
      <Avatar name={p.name} className={cn("h-7 w-7 text-xs", !online && "opacity-50")} />
      <span className={cn("truncate", self || online ? "text-foreground" : "text-muted-foreground")}>
        {p.name}
        {self && <span className="ml-1.5 align-middle font-mono text-[10px] text-muted-foreground">{t("roster.you")}</span>}
      </span>
    </div>
  );
}

function Section({
  title,
  list,
  selfId,
  onlineIds,
}: {
  title: string;
  list: Participant[];
  selfId?: string;
  onlineIds?: Set<string>;
}) {
  if (list.length === 0) return null;
  return (
    <div className="space-y-1">
      <h2 className="px-4 pb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/85">
        {title}
      </h2>
      {list.map((p) => (
        // Unknown onlineIds (e.g. before the stream seeds presence) defaults to
        // online so the roster never looks empty/ghosted on first paint.
        <Row key={p.id} p={p} self={p.id === selfId} online={onlineIds?.has(p.id) ?? true} />
      ))}
    </div>
  );
}

// Shared roster body — rendered inside the desktop aside and the mobile sheet.
export function RosterSections({
  members,
  selfId,
  onlineIds,
}: {
  members: Participant[];
  selfId?: string;
  onlineIds?: Set<string>;
}) {
  const t = useT();
  const humans = members.filter((m) => m.kind === "human");
  const agents = members.filter((m) => m.kind === "agent");
  return (
    <>
      <Section title={t("roster.humans")} list={humans} selfId={selfId} onlineIds={onlineIds} />
      {humans.length > 0 && agents.length > 0 && <Separator />}
      <Section title={t("roster.agents")} list={agents} selfId={selfId} onlineIds={onlineIds} />
    </>
  );
}

export function Roster({
  members,
  selfId,
  onlineIds,
  rooms,
  currentRoom,
  unread,
  onSelectRoom,
  onCreateRoom,
}: {
  members: Participant[];
  selfId?: string;
  onlineIds?: Set<string>;
  rooms: Room[];
  currentRoom: string;
  unread: Record<string, RoomUnread>;
  onSelectRoom: (slug: string) => void;
  onCreateRoom: (name: string) => Promise<void>;
}) {
  const t = useT();
  return (
    <aside
      aria-label={t("roster.label")}
      // Keyboard-focusable scroll region (WCAG 2.1.1 + axe
      // `scrollable-region-focusable`): otherwise keyboard users can't focus
      // the member list to arrow-scroll it independently.
      tabIndex={0}
      className="hidden w-56 flex-none flex-col gap-4 overflow-y-auto border-r border-border bg-chrome p-3 scrollbar-thin outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/40 md:flex"
    >
      {/* Rooms are the primary navigation axis, so they sit on top; the roster
          (global online presence) is secondary reference below. */}
      <RoomList
        rooms={rooms}
        currentRoom={currentRoom}
        unread={unread}
        onSelect={onSelectRoom}
        onCreate={onCreateRoom}
      />
      <Separator />
      <div aria-label={t("roster.onlineLabel")}>
        <RosterSections members={members} selfId={selfId} onlineIds={onlineIds} />
      </div>
    </aside>
  );
}
