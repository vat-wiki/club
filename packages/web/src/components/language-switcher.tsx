import { type Lang,LANG_LABEL, LANGS, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Languages } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Compact language switcher for the topbar. A single icon button that opens a
// small dropdown with the available languages, each labelled in its own
// language (so a user who can't read the current language can still find
// theirs). The choice persists to localStorage via the i18n provider.
//
// The dropdown is rendered via createPortal to document.body with fixed
// positioning so it escapes the topbar header's `overflow: hidden` clipping.
// Position is recalculated on open and resize so the menu stays anchored to
// the trigger button.
//
// Accessibility: a real <button> trigger with an aria-label, a focused
// listbox-like list with roving focus, Esc to close, click-outside to close,
// and the active option marked aria-current. We avoid pulling in a Radix
// Select/Menu primitive for two options — keeps the bundle lean.
export function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const [position, setPosition] = useState<{ top: string; left: string }>({
    top: "0px",
    left: "0px",
  });

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Compute menu position anchored below the trigger, and update on resize.
  const positionMenu = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPosition({
      top: `${rect.bottom + 4}px`,
      left: `${rect.right - 128}px`, // center-ish on trigger (min-w-[8rem]=128px)
    });
  };
  useEffect(() => {
    if (!open) return;
    positionMenu();
    window.addEventListener("resize", positionMenu);
    return () => window.removeEventListener("resize", positionMenu);
  }, [open]);

  // When the menu opens, focus the active option (or the first).
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const active = menuRef.current?.querySelector<HTMLButtonElement>(
        'button[aria-current="true"]',
      );
      (active ?? menuRef.current?.querySelector("button"))?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const choose = (next: Lang) => {
    setLang(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  // Minimal roving up/down within the option list.
  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    if (buttons.length === 0) return;
    const idx = buttons.findIndex((b) => b === document.activeElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      buttons[(idx + 1) % buttons.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      buttons[(idx - 1 + buttons.length) % buttons.length]?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      (document.activeElement as HTMLButtonElement | null)?.click();
    }
  };

  const menu = (
    <ul
      ref={menuRef}
      role="menu"
      aria-label={t("topbar.lang.aria")}
      onKeyDown={onMenuKeyDown}
      style={{ position: "fixed", top: position.top, left: position.left }}
      className="z-50 min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover p-1 shadow-lg shadow-black/40"
    >
      {LANGS.map((l) => (
        <li key={l} role="none">
          <button
            type="button"
            role="menuitemradio"
            aria-checked={l === lang}
            aria-current={l === lang ? "true" : undefined}
            data-testid={`lang-option-${l}`}
            onClick={() => choose(l)}
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded-sm px-2.5 py-1.5 text-left text-sm transition-colors",
              l === lang
                ? "bg-accent text-accent-foreground"
                : "text-popover-foreground hover:bg-accent/70",
            )}
          >
            <span>{LANG_LABEL[l]}</span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {l}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("topbar.lang.aria")}
        title={LANG_LABEL[lang]}
        data-testid="lang-switcher"
        onClick={() => setOpen((o) => !o)}
        className="tap-target inline-flex items-center gap-1.5 rounded-md border border-border bg-transparent px-2 font-mono text-xs text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Languages className="h-3.5 w-3.5" aria-hidden />
        <span aria-hidden className="uppercase">{lang}</span>
      </button>
      {open && typeof document !== "undefined" && createPortal(menu, document.body)}
    </div>
  );
}
