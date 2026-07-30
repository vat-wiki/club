import type { ChannelUnread } from "@/hooks/use-channels";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Hash, Plus } from "lucide-react";
import { type KeyboardEvent,useEffect, useRef, useState } from "react";

import { type Channel,CHANNEL_SLUG_REGEX } from "@club/shared";

// One channel row. The whole row is a <button> (keyboard-operable, focusable) so
// switching channels works with Tab + Enter/Space and gets a native focus ring.
// `aria-current="page"` marks the focused channel for SR navigation, complementing
// the visual "tuned-in" treatment (solid bg + mint signal bar).
function ChannelRow({
  channel,
  active,
  unread,
  mobile,
  onSelect,
}: {
  channel: Channel;
  active: boolean;
  unread?: ChannelUnread;
  mobile?: boolean;
  onSelect: (slug: string) => void;
}) {
  const t = useT();
  const count = unread?.count ?? 0;
  const mention = !!unread?.mention;
  const isSystem = channel.slug === "general";

  // Build the accessible name so SR users hear the channel + its unread state
  // (color/number alone isn't enough — WCAG 1.4.1).
  const labelParts = [`#${channel.slug}`];
  if (active) labelParts.push(t("channels.current"));
  if (count > 0) {
    labelParts.push(mention ? t("channels.unreadMention.aria", { count }) : t("channels.unread.aria", { count }));
  }
  const ariaLabel = labelParts.join(" · ");

  return (
    <button
      type="button"
      onClick={() => onSelect(channel.slug)}
      aria-current={active ? "page" : undefined}
      aria-label={ariaLabel}
      data-testid={`channel-row-${channel.slug}`}
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
        // Cross-channel @mention: amber left bar + faint wash (mirrors the message
        // row's pinged treatment), so a glance at the sidebar shows "someone @-ed
        // me there" even when the channel isn't focused.
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
              // channel; other channels use a dimmer neutral hash.
              isSystem
                ? "text-agent/40"
                : "text-muted-foreground/50",
        )}
      />
      <span className="min-w-0 flex-1 truncate text-left">{channel.slug}</span>
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

// Inline new-channel creation (design §1.5). The `+ new channel` row flips into an
// inline <input> on click — no dialog, no "join" ceremony (channels are open
// channels). Slug is validated live against the shared regex; an illegal submit
// shakes + goes destructive rather than blocking typing.
function NewChannelRow({
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
    if (!CHANNEL_SLUG_REGEX.test(name)) {
      setInvalid(true);
      // Clear the shake flag after the animation so a subsequent edit can re-arm.
      window.setTimeout(() => setInvalid(false), 450);
      return;
    }
    setBusy(true);
    try {
      await onCreate(name);
      // Success: collapse back to the idle "+ new channel" row.
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
        <label htmlFor="new-channel-input" className="sr-only">
          {t("channels.newChannelLabel")}
        </label>
        <input
          ref={inputRef}
          id="new-channel-input"
          value={value}
          disabled={busy}
          data-testid="new-channel-input"
          // Slug allowed chars only: guide input at the keystroke layer too.
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t("channels.newChannelPlaceholder")}
          aria-invalid={invalid}
          aria-describedby={invalid ? "new-channel-hint" : undefined}
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
            id="new-channel-hint"
            role={invalid ? "alert" : "status"}
            className="mt-1 font-mono text-[10px] text-destructive"
          >
            {busy ? t("channels.newChannelBusy") : t("channels.newChannelInvalid")}
          </p>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      data-testid="new-channel-button"
      className={cn(
        "flex w-full items-center gap-2 rounded-md font-mono text-sm text-muted-foreground/60 transition-colors duration-fast hover:bg-accent/70 hover:text-foreground focus-visible:outline-none focus-visible:bg-accent/70 focus-visible:text-foreground",
        mobile ? "min-h-[44px] px-4 py-1.5" : "min-h-[36px] px-4 py-1.5",
      )}
    >
      <Plus aria-hidden className="h-3.5 w-3.5 flex-none text-muted-foreground/50" />
      <span className="text-muted-foreground/60">{t("channels.newChannel")}</span>
    </button>
  );
}

// The CHANNELS section body — rendered inside the desktop sidebar AND the mobile
// channel sheet (the `mobile` flag bumps touch targets). A listbox-like group of
// channel buttons under a section heading.
export function ChannelList({
  channels,
  currentChannel,
  unread,
  mobile,
  onSelect,
  onCreate,
}: {
  channels: Channel[];
  currentChannel: string;
  unread: Record<string, ChannelUnread>;
  mobile?: boolean;
  onSelect: (slug: string) => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const t = useT();
  return (
    <section className="space-y-1" aria-label={t("channels.title")}>
      <h2 className="px-4 pb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/85">
        {t("channels.title")}
      </h2>
      {channels.length === 0 ? (
        // Loading/empty: keep the section present (the heading + new-channel afford
        // it) rather than collapsing — matches the "list channels" mental model.
        <div className="space-y-1 px-4 py-1.5 font-mono text-xs text-muted-foreground/60">
          {t("channels.loading")}
        </div>
      ) : (
        <div className="space-y-0.5">
          {channels.map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              active={channel.slug === currentChannel}
              unread={unread[channel.slug]}
              mobile={mobile}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
      <div className="pt-0.5">
        <NewChannelRow mobile={mobile} onCreate={onCreate} />
      </div>
    </section>
  );
}
