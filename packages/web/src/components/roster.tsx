import { Avatar } from "@/components/avatar";
import { ChannelList } from "@/components/channel-list";
import { Separator } from "@/components/ui/separator";
import type { ChannelUnread } from "@/hooks/use-channels";
import { useT } from "@/lib/i18n";
import { sanitizeDisplayString } from "@/lib/sanitize";
import { cn } from "@/lib/utils";
import { Pencil, UserMinus } from "lucide-react";

import type { Channel,Participant } from "@club/shared";

function Row({
  p,
  self,
  online,
  onEditProfile,
  onEditBio,
  onKick,
}: {
  p: Participant;
  self: boolean;
  online: boolean;
  /** When provided AND this is the self row, the row becomes a button that opens the bio editor. */
  onEditProfile?: () => void;
  /** Edit this member's bio (open model: anyone may edit anyone). Non-self rows only. */
  onEditBio?: () => void;
  /** Kick this member (open model: anyone may kick anyone). Non-self rows only. */
  onKick?: () => void;
}) {
  const t = useT();
  // Single-line, control-char-stripped bio for the secondary line. Empty bio
  // ("" = unset) renders nothing so the roster stays compact. CSS `truncate`
  // caps the visual width; the full text is server-capped at MAX_BIO.
  const bio = sanitizeDisplayString(p.bio);
  const editable = self && !!onEditProfile;
  const hasActions = !self && (!!onEditBio || !!onKick);
  const className = cn(
    "flex min-h-[44px] w-full items-center gap-2 rounded-md px-4 py-1.5 text-left text-sm transition-colors hover:bg-accent/70 active:bg-accent",
    editable &&
      "cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/40",
  );
  // Name + optional bio stacked in a min-w-0 column so `truncate` can clip.
  const inner = (
    <>
      {/* Offline (no live SSE connection) members read as "who's here now" via
          the dimmer avatar; the name keeps a contrast-safe muted color rather
          than an opacity multiplier, which previously dropped it below AA
          (opacity-50 on muted-foreground → 2.87:1). */}
      <Avatar name={p.name} className={cn("h-7 w-7 text-xs", !online && "opacity-50")} />
      <div className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate",
            self || online ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {p.name}
          {self && (
            <span className="ml-1.5 align-middle font-mono text-[10px] text-muted-foreground">
              {t("roster.you")}
            </span>
          )}
        </span>
        {bio && <p className="truncate text-xs text-muted-foreground">{bio}</p>}
      </div>
    </>
  );
  // The self row is the only entry point to edit your own bio, so it becomes a
  // real <button> (keyboard-focusable, Enter/Space activation) when an editor
  // is wired up. Everyone else stays a plain div (with hover-revealed actions).
  if (editable) {
    return (
      <button
        type="button"
        className={className}
        onClick={onEditProfile}
        aria-label={t("roster.editProfile")}
        title={t("roster.editProfile")}
      >
        {inner}
      </button>
    );
  }
  if (hasActions) {
    return (
      <div className={cn("group relative", className)}>
        {inner}
        <div className="absolute right-1 hidden items-center gap-0.5 rounded-md bg-chrome/95 p-0.5 group-hover:flex group-focus-within:flex">
          {onEditBio && (
            <button
              type="button"
              onClick={onEditBio}
              aria-label={t("roster.editBio", { name: p.name })}
              title={t("roster.editBio", { name: p.name })}
              data-testid={`edit-bio-${p.id}`}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none"
            >
              <Pencil aria-hidden className="h-3 w-3" />
            </button>
          )}
          {onKick && (
            <button
              type="button"
              onClick={onKick}
              aria-label={t("roster.kick", { name: p.name })}
              title={t("roster.kick", { name: p.name })}
              data-testid={`kick-${p.id}`}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/15 hover:text-destructive focus-visible:outline-none"
            >
              <UserMinus aria-hidden className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    );
  }
  return <div className={className}>{inner}</div>;
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
  onEditProfile,
  onEditBio,
  onKick,
}: {
  members: Participant[];
  selfId?: string;
  onlineIds?: Set<string>;
  /** Opens the bio editor for the self row. Optional: only the self row uses it. */
  onEditProfile?: () => void;
  /** Edit any member's bio (open model). Bound per-member for non-self rows. */
  onEditBio?: (p: Participant) => void;
  /** Kick any member (open model). Bound per-member for non-self rows. */
  onKick?: (p: Participant) => void;
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
        <Row
          key={p.id}
          p={p}
          self={p.id === selfId}
          online={true}
          onEditProfile={onEditProfile}
          onEditBio={onEditBio ? () => onEditBio(p) : undefined}
          onKick={onKick ? () => onKick(p) : undefined}
        />
      ))}
      {offline.map((p) => (
        <Row
          key={p.id}
          p={p}
          self={p.id === selfId}
          online={false}
          onEditProfile={onEditProfile}
          onEditBio={onEditBio ? () => onEditBio(p) : undefined}
          onKick={onKick ? () => onKick(p) : undefined}
        />
      ))}
    </div>
  );
}

export function Roster({
  members,
  selfId,
  onlineIds,
  channels,
  currentChannel,
  unread,
  onSelectChannel,
  onCreateChannel,
  onRenameChannel,
  onDeleteChannel,
  onEditProfile,
  onEditBio,
  onKick,
}: {
  members: Participant[];
  selfId?: string;
  onlineIds?: Set<string>;
  channels: Channel[];
  currentChannel: string;
  unread: Record<string, ChannelUnread>;
  onSelectChannel: (slug: string) => void;
  onCreateChannel: (name: string) => Promise<void>;
  onRenameChannel?: (slug: string, displayName: string | null) => Promise<void>;
  onDeleteChannel?: (slug: string) => Promise<void>;
  /** Opens the bio editor for the self row. */
  onEditProfile?: () => void;
  /** Edit any member's bio (open model). */
  onEditBio?: (p: Participant) => void;
  /** Kick any member (open model). */
  onKick?: (p: Participant) => void;
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
      {/* Channels are the primary navigation axis, so they sit on top; the roster
          (global online presence) is secondary reference below. */}
      <ChannelList
        channels={channels}
        currentChannel={currentChannel}
        unread={unread}
        onSelect={onSelectChannel}
        onCreate={onCreateChannel}
        onRename={onRenameChannel}
        onDelete={onDeleteChannel}
      />
      <Separator />
      <div aria-label={t("roster.onlineLabel")}>
        <RosterSections
          members={members}
          selfId={selfId}
          onlineIds={onlineIds}
          onEditProfile={onEditProfile}
          onEditBio={onEditBio}
          onKick={onKick}
        />
      </div>
    </aside>
  );
}
