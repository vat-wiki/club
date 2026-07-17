import { useState } from "react";
import { Check, ChevronDown, Copy, Key, LogOut, MoreVertical, Radio, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useCopy } from "@/hooks/use-copy";
import { LANGS, LANG_LABEL, useI18n } from "@/lib/i18n";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Participant } from "@club/shared";
import type { Status as TopbarStatus } from "./topbar";

// Re-export the Status type for callers that need it.
export type { TopbarStatus as Status };

const statusColor: Record<TopbarStatus, string> = {
  connected: "bg-agent",
  connecting: "bg-human",
  lost: "bg-destructive",
};

const statusKey: Record<TopbarStatus, string> = {
  connected: "status.connected",
  connecting: "status.connecting",
  lost: "status.reconnecting",
};

const COPY_LIVE = "mobile-menu-viewkey-copy-status";

type Props = {
  status: TopbarStatus;
  members: Participant[];
  onlineIds?: Set<string>;
  key_: string | null;
  onSignOutRequest: () => void;
  onOpenRoster: () => void;
};

export function MobileTopbarMenu({
  status,
  members,
  onlineIds,
  key_,
  onSignOutRequest,
  onOpenRoster,
}: Props) {
  const t = useT();
  const { lang, setLang } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewKeyOpen, setViewKeyOpen] = useState(false);
  const { state, copy, reset } = useCopy();
  const copied = state === "copied";
  const failed = state === "failed";

  const cycleLang = () => {
    const idx = LANGS.indexOf(lang);
    const next = LANGS[(idx + 1) % LANGS.length];
    setLang(next);
  };

  const rosterCount = onlineIds?.size ?? members.length;

  const menu = (
    <div className="flex flex-col gap-1 px-2">
      {/* Connection status */}
      <div className="flex items-center gap-2 px-2 py-2.5">
        <Radio className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span
          className={cn(
            "h-2.5 w-2.5 rounded-full transition-colors duration-slow",
            statusColor[status],
          )}
          aria-hidden
        />
        <span className="flex-1 text-sm text-muted-foreground">{t(statusKey[status])}</span>
      </div>

      <div className="h-px bg-border" />

      {/* Language switcher */}
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2.5 text-sm transition-colors hover:bg-accent/70"
        onClick={cycleLang}
        aria-label={t("topbar.menu.lang.aria", { lang: LANG_LABEL[lang] })}
      >
        <span className="font-mono text-xs text-muted-foreground">{t("topbar.menu.lang")}</span>
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-xs uppercase text-muted-foreground">{lang}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        </span>
      </button>

      {/* Roster */}
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2.5 text-sm transition-colors hover:bg-accent/70"
        onClick={() => {
          setMenuOpen(false);
          onOpenRoster();
        }}
      >
        <span className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="text-muted-foreground">{t("topbar.menu.roster")}</span>
        </span>
        <span className="font-mono text-xs text-muted-foreground">{rosterCount}</span>
      </button>

      {/* View key */}
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2.5 text-sm transition-colors hover:bg-accent/70"
        onClick={() => {
          setMenuOpen(false);
          setViewKeyOpen(true);
        }}
        aria-label={t("viewKey.trigger.aria")}
      >
        <span className="text-muted-foreground">{t("viewKey.open")}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      </button>

      <div className="h-px bg-border" />

      {/* Sign out */}
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-2 py-2.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
        onClick={() => {
          setMenuOpen(false);
          onSignOutRequest();
        }}
      >
        <LogOut className="h-4 w-4" aria-hidden />
        <span>{t("topbar.signOut.label")}</span>
      </button>
    </div>
  );

  return (
    <>
      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label={t("topbar.menu.aria")}
            aria-haspopup="dialog"
            className="tap-target inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
          >
            <MoreVertical className="h-4 w-4" aria-hidden />
          </button>
        </DialogTrigger>
        <DialogContent
          showClose
          closeLabel={t("dialog.close")}
          className="left-0 right-0 top-auto bottom-0 h-auto max-h-[80dvh] w-full translate-x-0 translate-y-0 rounded-none rounded-t-lg border-t border-border p-0 data-[state=open]:slide-in-from-bottom-full data-[state=closed]:slide-out-to-bottom-full"
        >
          <DialogTitle className="sr-only">{t("topbar.menu.title")}</DialogTitle>
          <div className="flex flex-col gap-4 overflow-y-auto px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
            <h2 className="font-display text-sm font-semibold tracking-tight">
              {t("topbar.menu.title")}<span className="text-agent">.</span>
            </h2>
            {menu}
          </div>
        </DialogContent>
      </Dialog>

      {/* View key dialog, controlled from the menu */}
      <Dialog
        open={viewKeyOpen}
        onOpenChange={(o) => {
          setViewKeyOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="max-w-[440px] gap-5" closeLabel={t("dialog.close")}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5 text-human" aria-hidden />
              {t("viewKey.title")}
            </DialogTitle>
            <DialogDescription>{t("viewKey.desc")}</DialogDescription>
          </DialogHeader>
          {key_ ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <p id="viewkey-label" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("viewKey.label")}
                </p>
                <output
                  aria-labelledby="viewkey-label"
                  className="block w-full break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-sm text-foreground"
                >
                  {key_}
                </output>
              </div>
              <Button
                variant={copied ? "outline" : "secondary"}
                className="w-full gap-2"
                onClick={() => copy(key_)}
                aria-describedby={COPY_LIVE}
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" aria-hidden />
                    {t("viewKey.copied")}
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" aria-hidden />
                    {t("viewKey.copy")}
                  </>
                )}
              </Button>
              {failed && (
                <p role="alert" className="text-sm text-destructive">
                  {t("viewKey.copyFailed")}
                </p>
              )}
              <p
                id={COPY_LIVE}
                role="status"
                aria-live="polite"
                className="sr-only"
              >
                {copied ? t("viewKey.copyAnnounced") : ""}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("viewKey.notFound")}</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
