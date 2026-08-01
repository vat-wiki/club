import { Avatar } from "@/components/avatar";
import { BioEditor } from "@/components/bio-editor";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCopy } from "@/hooks/use-copy";
import { LANG_LABEL, LANGS, useI18n, useT } from "@/lib/i18n";
import { sanitizeDisplayString } from "@/lib/sanitize";
import { cn } from "@/lib/utils";
import { Check,Copy, Hash, LogOut, Trash2, UserMinus } from "lucide-react";
import { type KeyboardEvent,type ReactNode,useEffect, useRef, useState } from "react";

import type { Channel,Participant } from "@club/shared";

// Full-screen Settings overlay - the single management surface for club. All
// mutating actions that used to live as hover-revealed icons on the sidebar
// lists (channel rename/delete, member bio/kick) plus the account actions
// (own bio, view+copy key, sign out) and language live here, so the sidebar
// goes back to pure navigation. Destructive actions (delete channel, kick) go
// through an in-app ConfirmDialog instead of window.confirm.
//
// The dialog is a controlled shell: the parent owns `open` and wires every
// action to the real API call + state refresh. Bio saves may throw - the
// BioEditor surfaces the message inline and stays open.

const KEY_COPY_LIVE = "settings-key-copy-status";

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/85">
      {children}
    </h2>
  );
}

// One channel row inside Settings: display name + slug, with inline rename and
// a delete affordance (general is system-managed, so delete is hidden). Rename
// mirrors the sidebar's old inline-edit behavior: click -> input, Enter/blur
// saves, Escape cancels.
function ChannelManageRow({
  channel,
  onRename,
  onDelete,
}: {
  channel: Channel;
  onRename: (displayName: string | null) => Promise<void>;
  onDelete: () => void;
}) {
  const t = useT();
  const isSystem = channel.slug === "general";

  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(channel.displayName ?? "");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);

  const submitRename = async () => {
    const next = value.trim();
    if (next === (channel.displayName ?? "")) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    try {
      await onRename(next === "" ? null : next);
      setRenaming(false);
    } catch {
      // Leave the input open so the user can retry.
    } finally {
      setBusy(false);
    }
  };

  if (renaming) {
    return (
      <div className="flex items-center gap-1.5 py-1">
        <label htmlFor={`settings-rename-${channel.slug}`} className="sr-only">
          {t("channels.renameLabel")}
        </label>
        <input
          ref={inputRef}
          id={`settings-rename-${channel.slug}`}
          value={value}
          disabled={busy}
          data-testid={`settings-rename-input-${channel.slug}`}
          maxLength={60}
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t("channels.renamePlaceholder")}
          className="w-full border-b border-agent bg-transparent px-1 font-mono text-sm outline-none"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submitRename();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setValue(channel.displayName ?? "");
              setRenaming(false);
            }
          }}
          onBlur={() => void submitRename()}
        />
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-2 py-1">
      <Hash aria-hidden className="h-3.5 w-3.5 flex-none text-muted-foreground/50" />
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">
          {channel.displayName ?? <span className="font-mono text-muted-foreground">#{channel.slug}</span>}
        </span>
        {channel.displayName && (
          <span className="block truncate font-mono text-[11px] text-muted-foreground/60">#{channel.slug}</span>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          setValue(channel.displayName ?? "");
          setRenaming(true);
        }}
        aria-label={t("channels.rename")}
        title={t("channels.rename")}
        data-testid={`settings-rename-${channel.slug}`}
        className="flex h-7 flex-none items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("channels.rename")}
      </button>
      {!isSystem && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={t("channels.delete")}
          title={t("channels.delete")}
          data-testid={`settings-delete-${channel.slug}`}
          className="flex h-7 flex-none items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Trash2 aria-hidden className="h-3.5 w-3.5" />
        </button>
      )}
      {isSystem && (
        <span className="flex-none font-mono text-[10px] text-muted-foreground/50">{t("settings.channel.system")}</span>
      )}
    </div>
  );
}

// One member row inside Settings: avatar + name (self marked) + inline bio
// editor + kick (hidden for self). Open model: anyone may edit anyone's bio
// and kick anyone.
function MemberManageRow({
  p,
  self,
  online,
  onSaveBio,
  onKick,
}: {
  p: Participant;
  self: boolean;
  online: boolean;
  onSaveBio: (bio: string) => Promise<void>;
  onKick?: () => void;
}) {
  const t = useT();
  return (
    <div className="flex items-start gap-2 py-1.5">
      <Avatar name={p.name} className={cn("mt-0.5 h-7 w-7 flex-none text-xs", !online && "opacity-50")} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-1.5">
          <span className={cn("truncate text-sm", self || online ? "text-foreground" : "text-muted-foreground")}>
            {p.name}
            {self && (
              <span className="ml-1.5 align-middle font-mono text-[10px] text-muted-foreground">
                {t("roster.you")}
              </span>
            )}
          </span>
          {!self && onKick && (
            <button
              type="button"
              onClick={onKick}
              aria-label={t("roster.kick", { name: p.name })}
              title={t("roster.kick", { name: p.name })}
              data-testid={`settings-kick-${p.id}`}
              className="flex h-7 flex-none items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <UserMinus aria-hidden className="h-3.5 w-3.5" />
              {t("common.kick")}
            </button>
          )}
        </div>
        <BioEditor
          bio={sanitizeDisplayString(p.bio)}
          onSave={onSaveBio}
          editLabel={t("roster.editBio", { name: p.name })}
          emptyText={t("bio.empty")}
          testId={p.id}
        />
      </div>
    </div>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
  me,
  members,
  selfId,
  onlineIds,
  channels,
  key_,
  onSaveMyBio,
  onSaveMemberBio,
  onSignOutRequest,
  onRenameChannel,
  onDeleteChannel,
  onKickMember,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  me: Participant | null;
  members: Participant[];
  selfId?: string;
  onlineIds?: Set<string>;
  channels: Channel[];
  key_: string | null;
  onSaveMyBio: (bio: string) => Promise<void>;
  onSaveMemberBio: (p: Participant, bio: string) => Promise<void>;
  onSignOutRequest: () => void;
  onRenameChannel: (slug: string, displayName: string | null) => Promise<void>;
  onDeleteChannel: (slug: string) => Promise<void>;
  onKickMember: (p: Participant) => Promise<void>;
}) {
  const t = useT();
  const { lang, setLang } = useI18n();
  const { state: copyState, copy } = useCopy();
  const copied = copyState === "copied";
  const failed = copyState === "failed";

  // Pending destructive action (channel delete / member kick) -> ConfirmDialog.
  const [deleteTarget, setDeleteTarget] = useState<Channel | null>(null);
  const [kickTarget, setKickTarget] = useState<Participant | null>(null);

  const onlineSet = onlineIds ?? new Set(members.map((m) => m.id));
  const sortByName = (a: Participant, b: Participant) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const sortedMembers = [...members].sort((a, b) => {
    const ao = onlineSet.has(a.id) ? 0 : 1;
    const bo = onlineSet.has(b.id) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    // Self floats to the top of its group.
    if (a.id === selfId) return -1;
    if (b.id === selfId) return 1;
    return sortByName(a, b);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showClose
        closeLabel={t("dialog.close")}
        // Full-screen overlay: covers the viewport, no centering/translate,
        // rounded off. Inner column scrolls; content is capped to a readable
        // width. Overrides the default centered dialog styles via twMerge.
        className="inset-0 left-0 top-0 block h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 p-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-1"
      >
        <DialogTitle className="sr-only">{t("settings.title")}</DialogTitle>
        <div className="flex h-full flex-col">
          <header className="flex flex-none items-center gap-2 border-b border-border bg-chrome px-4 py-3 sm:px-6">
            <h2 className="font-display text-lg font-semibold tracking-tight">
              {t("settings.title")}
              <span className="text-agent">.</span>
            </h2>
          </header>
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-6 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6">
              {/* Account */}
              <section className="space-y-3">
                <SectionTitle>{t("settings.account")}</SectionTitle>
                <div className="space-y-4 rounded-lg border border-border bg-card/40 p-4">
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {t("settings.account.bio")}
                    </p>
                    {me && (
                      <BioEditor
                        bio={sanitizeDisplayString(me.bio)}
                        onSave={onSaveMyBio}
                        editLabel={t("roster.editProfile")}
                        emptyText={t("settings.account.noBio")}
                        testId="me"
                      />
                    )}
                  </div>
                  <div className="h-px bg-border" />
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {t("settings.account.key")}
                    </p>
                    {key_ ? (
                      <div className="space-y-2">
                        <output
                          aria-label={t("settings.account.key")}
                          className="block w-full break-all rounded-md border border-border bg-muted/40 p-2.5 font-mono text-xs text-foreground"
                        >
                          {key_}
                        </output>
                        <Button
                          variant={copied ? "outline" : "secondary"}
                          className="w-full gap-2"
                          onClick={() => copy(key_)}
                          aria-describedby={KEY_COPY_LIVE}
                          data-testid="settings-copy-key"
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
                        <p id={KEY_COPY_LIVE} role="status" aria-live="polite" className="sr-only">
                          {copied ? t("viewKey.copyAnnounced") : ""}
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t("viewKey.notFound")}</p>
                    )}
                  </div>
                  <div className="h-px bg-border" />
                  <button
                    type="button"
                    onClick={onSignOutRequest}
                    className="flex w-full items-center justify-center gap-2 rounded-md border border-destructive/30 px-3 py-2.5 text-sm text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid="settings-sign-out"
                  >
                    <LogOut className="h-4 w-4" aria-hidden />
                    {t("settings.account.signOut")}
                  </button>
                </div>
              </section>

              {/* Channels */}
              <section className="space-y-3">
                <SectionTitle>{t("settings.channels")}</SectionTitle>
                <div className="space-y-0.5 rounded-lg border border-border bg-card/40 p-3">
                  {channels.length === 0 ? (
                    <p className="px-1 py-2 font-mono text-xs text-muted-foreground/60">{t("channels.loading")}</p>
                  ) : (
                    channels.map((ch) => (
                      <ChannelManageRow
                        key={ch.id}
                        channel={ch}
                        onRename={(displayName) => onRenameChannel(ch.slug, displayName)}
                        onDelete={() => setDeleteTarget(ch)}
                      />
                    ))
                  )}
                </div>
              </section>

              {/* Members */}
              <section className="space-y-3">
                <SectionTitle>{t("settings.members")}</SectionTitle>
                <div className="space-y-0.5 rounded-lg border border-border bg-card/40 p-3">
                  {sortedMembers.map((p) => (
                    <MemberManageRow
                      key={p.id}
                      p={p}
                      self={p.id === selfId}
                      online={onlineSet.has(p.id)}
                      onSaveBio={(bio) => onSaveMemberBio(p, bio)}
                      onKick={p.id === selfId ? undefined : () => setKickTarget(p)}
                    />
                  ))}
                </div>
              </section>

              {/* Language */}
              <section className="space-y-3">
                <SectionTitle>{t("settings.language")}</SectionTitle>
                <div
                  role="radiogroup"
                  aria-label={t("settings.language")}
                  className="flex flex-col gap-0.5 rounded-lg border border-border bg-card/40 p-2"
                >
                  {LANGS.map((l) => (
                    <button
                      key={l}
                      type="button"
                      role="radio"
                      aria-checked={l === lang}
                      data-testid={`settings-lang-${l}`}
                      onClick={() => setLang(l)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                        l === lang
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
                      )}
                    >
                      <span>{LANG_LABEL[l]}</span>
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          {l}
                        </span>
                        {l === lang && <Check className="h-3.5 w-3.5 text-agent" aria-hidden />}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      </DialogContent>

      {/* Destructive confirms (replace the old window.confirm). */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t("confirm.deleteChannel.title")}
        description={deleteTarget ? t("channels.deleteConfirm", { channel: deleteTarget.displayName ?? deleteTarget.slug }) : ""}
        confirmLabel={t("common.delete")}
        onConfirm={() => {
          if (deleteTarget) {
            void onDeleteChannel(deleteTarget.slug);
            setDeleteTarget(null);
          }
        }}
      />
      <ConfirmDialog
        open={!!kickTarget}
        onOpenChange={(o) => !o && setKickTarget(null)}
        title={t("confirm.kick.title")}
        description={kickTarget ? t("roster.kickConfirm", { name: kickTarget.name }) : ""}
        confirmLabel={t("common.kick")}
        onConfirm={() => {
          if (kickTarget) {
            void onKickMember(kickTarget);
            setKickTarget(null);
          }
        }}
      />
    </Dialog>
  );
}
