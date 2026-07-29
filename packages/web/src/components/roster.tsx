import { Avatar } from "@/components/avatar";
import { RoomList } from "@/components/room-list";
import { Separator } from "@/components/ui/separator";
import type { RoomUnread } from "@/hooks/use-rooms";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import type { Participant, Room } from "@club/shared";

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

// Shared roster body — rendered inside the desktop aside and the mobile sheet.
// Category-blind: a single flat list in server (registration) order. club does
// NOT split humans from agents — there is no such distinction in the data model
// (see .pd-docs/requirements/category-blind.md).
//
// Online members are sorted to the top so it's easy to see who's available.
export function RosterSections({
  members,
  selfId,
  onlineIds,
}: {
  members: Participant[];
  selfId?: string;
  onlineIds?: Set<string>;
}) {
  // Split into online and offline, then sort each group.
  // Online members go first, sorted by name (case-insensitive).
  // Offline members follow, also sorted by name.
  const onlineSet = onlineIds ?? new Set(members.map((m) => m.id)); // default all online
  const online: Participant[] = [];
  const offline: Participant[] = [];

  for (const m of members) {
    if (onlineSet.has(m.id)) {
      online.push(m);
    } else {
      offline.push(m);
    }
  }

  // Sort by name (case-insensitive) within each group
  const sortByName = (a: Participant, b: Participant) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  online.sort(sortByName);
  offline.sort(sortByName);

  // Move self to the front of whichever group they're in
  const moveSelfToFront = (list: Participant[], selfId?: string) => {
    if (!selfId) return;
    const idx = list.findIndex((m) => m.id === selfId);
    if (idx > 0) {
      const [self] = list.splice(idx, 1);
      list.unshift(self);
    }
  };
  moveSelfToFront(online, selfId);
  moveSelfToFront(offline, selfId);

  return (
    <div className="space-y-1">
      {online.map((p) => (
        <Row key={p.id} p={p} self={p.id === selfId} online={true} />
      ))}
      {offline.map((p) => (
        <Row key={p.id} p={p} self={p.id === selfId} online={false} />
      ))}
    </div>
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
