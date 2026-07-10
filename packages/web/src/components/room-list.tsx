import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Hash, Plus } from "lucide-react";
import { ROOM_SLUG_REGEX, type Room } from "@club/shared";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { RoomUnread } from "@/hooks/use-rooms";

// One room row. The whole row is a <button> (keyboard-operable, focusable) so
// switching rooms works with Tab + Enter/Space and gets a native focus ring.
// `aria-current="page"` marks the focused room for SR navigation, complementing
// the visual "tuned-in" treatment (solid bg + mint signal bar).
function RoomRow({
  room,
  active,
  unread,
  mobile,
  onSelect,
}: {
  room: Room;
  active: boolean;
  unread?: RoomUnread;
  mobile?: boolean;
  onSelect: (slug: string) => void;
}) {
  const t = useT();
  const count = unread?.count ?? 0;
  const mention = !!unread?.mention;
  const isSystem = room.slug === "general";

  // Build the accessible name so SR users hear the room + its unread state
  // (color/number alone isn't enough — WCAG 1.4.1).
  const labelParts = [`#${room.slug}`];
  if (active) labelParts.push(t("rooms.current"));
  if (count > 0) {
    labelParts.push(mention ? t("rooms.unreadMention.aria", { count }) : t("rooms.unread.aria", { count }));
  }
  const ariaLabel = labelParts.join(" · ");

  return (
    <button
      type="button"
      onClick={() => onSelect(room.slug)}
      aria-current={active ? "page" : undefined}
      aria-label={ariaLabel}
      data-testid={`room-row-${room.slug}`}
      className={cn(
        // Compact nav height on desktop (36px), bumped to a 44px touch target on
        // mobile (WCAG 2.5.5). mono reinforces "slug = addressable identifier".
        "group flex w-full items-center gap-2 rounded-md font-mono text-sm transition-colors duration-fast",
        mobile ? "min-h-[44px] px-4 py-1.5" : "min-h-[36px] px-4 py-1.5",
        active
          ? // Tuned-in: solid accent fill + a 2px mint inset signal bar (the
            // "active channel" mark, mirroring the message-row pinged手法).
            "bg-accent font-medium text-foreground shadow-[inset_2px_0_0_0_hsl(var(--agent))]"
          : "text-muted-foreground hover:bg-accent/70 hover:text-foreground focus-visible:bg-accent/70 focus-visible:text-foreground focus-visible:outline-none",
        // Cross-room @mention: amber left bar + faint wash (mirrors the message
        // row's pinged treatment), so a glance at the sidebar shows "someone @-ed
        // me there" even when the room isn't focused.
        !active && mention && "border-l-2 border-l-human/50 bg-human/5",
      )}
    >
      <Hash
        aria-hidden
        className={cn(
          "h-3.5 w-3.5 flex-none",
          active
            ? "text-agent/80"
            : // `general` keeps a faint mint hash at rest to mark it as the system
              // channel; other rooms use a dimmer neutral hash.
              isSystem
                ? "text-agent/40"
                : "text-muted-foreground/50",
        )}
      />
      <span className="min-w-0 flex-1 truncate text-left">{room.slug}</span>
      {count > 0 && (
        // Unread pill. Mint = generic new signal; amber = includes a @mention
        // (someone is calling you). tabular-nums keeps the digit width stable as
        // the count changes. Does NOT pulse/blink (that's agent-pulse's job).
        <span
          aria-hidden
          className={cn(
            "flex h-[18px] min-w-[18px] flex-none items-center justify-center rounded-full px-1 text-center text-[10px] leading-none tabular-nums",
            mention ? "bg-human/25 text-human" : "bg-agent/15 text-agent",
            // 0→1 entrance: a quick zoom+fade so the pill "arrives".
            "animate-in zoom-in-50 fade-in-0 duration-fast",
          )}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}

// Inline new-room creation (design §1.5). The `+ new room` row flips into an
// inline <input> on click — no dialog, no "join" ceremony (rooms are open
// channels). Slug is validated live against the shared regex; an illegal submit
// shakes + goes destructive rather than blocking typing.
function NewRoomRow({
  mobile,
  onCreate,
}: {
  mobile?: boolean;
  onCreate: (name: string) => Promise<void>;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const submit = async () => {
    const name = value.trim().toLowerCase();
    if (!ROOM_SLUG_REGEX.test(name)) {
      setInvalid(true);
      // Clear the shake flag after the animation so a subsequent edit can re-arm.
      window.setTimeout(() => setInvalid(false), 450);
      return;
    }
    setBusy(true);
    try {
      await onCreate(name);
      // Success: collapse back to the idle "+ new room" row.
      setValue("");
      setEditing(false);
    } catch {
      // Network/server error: surface as invalid (destructive) + shake; the
      // input stays open so the user can retry without retyping.
      setInvalid(true);
      window.setTimeout(() => setInvalid(false), 450);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="px-4 py-1.5">
        {/* Visually-hidden label gives the inline input an accessible name. */}
        <label htmlFor="new-room-input" className="sr-only">
          {t("rooms.newRoomLabel")}
        </label>
        <input
          ref={inputRef}
          id="new-room-input"
          value={value}
          disabled={busy}
          data-testid="new-room-input"
          // Slug allowed chars only: guide input at the keystroke layer too.
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t("rooms.newRoomPlaceholder")}
          aria-invalid={invalid}
          aria-describedby={invalid ? "new-room-hint" : undefined}
          className={cn(
            "w-full border-b bg-transparent px-1 font-mono text-sm outline-none transition-colors duration-fast placeholder:text-muted-foreground/50 focus:border-agent",
            invalid ? "border-destructive text-destructive animate-shake" : "border-border",
          )}
          onChange={(e) => {
            setValue(e.target.value);
            if (invalid) setInvalid(false);
          }}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setValue("");
              setEditing(false);
            }
          }}
          onBlur={() => {
            // Collapse if the user navigates away empty-handed; keep it open
            // while busy so a pending create isn't aborted by a stray blur.
            if (!value && !busy) setEditing(false);
          }}
        />
        {(invalid || busy) && (
          <p
            id="new-room-hint"
            role={invalid ? "alert" : "status"}
            className="mt-1 font-mono text-[10px] text-destructive"
          >
            {busy ? t("rooms.newRoomBusy") : t("rooms.newRoomInvalid")}
          </p>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      data-testid="new-room-button"
      className={cn(
        "flex w-full items-center gap-2 rounded-md font-mono text-sm text-muted-foreground/60 transition-colors duration-fast hover:bg-accent/70 hover:text-foreground focus-visible:outline-none focus-visible:bg-accent/70 focus-visible:text-foreground",
        mobile ? "min-h-[44px] px-4 py-1.5" : "min-h-[36px] px-4 py-1.5",
      )}
    >
      <Plus aria-hidden className="h-3.5 w-3.5 flex-none text-muted-foreground/50" />
      <span className="text-muted-foreground/60">{t("rooms.newRoom")}</span>
    </button>
  );
}

// The ROOMS section body — rendered inside the desktop sidebar AND the mobile
// room sheet (the `mobile` flag bumps touch targets). A listbox-like group of
// room buttons under a section heading.
export function RoomList({
  rooms,
  currentRoom,
  unread,
  mobile,
  onSelect,
  onCreate,
}: {
  rooms: Room[];
  currentRoom: string;
  unread: Record<string, RoomUnread>;
  mobile?: boolean;
  onSelect: (slug: string) => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const t = useT();
  return (
    <section className="space-y-1" aria-label={t("rooms.title")}>
      <h2 className="px-4 pb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/85">
        {t("rooms.title")}
      </h2>
      {rooms.length === 0 ? (
        // Loading/empty: keep the section present (the heading + new-room afford
        // it) rather than collapsing — matches the "list channels" mental model.
        <div className="space-y-1 px-4 py-1.5 font-mono text-xs text-muted-foreground/60">
          {t("rooms.loading")}
        </div>
      ) : (
        <div className="space-y-0.5">
          {rooms.map((room) => (
            <RoomRow
              key={room.id}
              room={room}
              active={room.slug === currentRoom}
              unread={unread[room.slug]}
              mobile={mobile}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
      <div className="pt-0.5">
        <NewRoomRow mobile={mobile} onCreate={onCreate} />
      </div>
    </section>
  );
}
