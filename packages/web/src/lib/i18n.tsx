import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// ──────────────────────────────────────────────────────────────────────────
// Lightweight i18n for club/web.
//
// No external i18n library (react-intl / i18next / lingui). club has no
// account system, so the language preference is a device-local choice stored
// in localStorage. We ship two dictionaries (zh, en) and a tiny `t(key)`
// lookup + a React context/hook that re-renders the subtree on switch.
//
// Design notes:
//  - Keys are dot-namespaced strings (e.g. "auth.join"). `t` returns the
//    string for the active language; missing keys fall back to zh, then to
//    the key itself (so a typo is visible, not a silent empty render).
//  - Interpolation is minimal: `{var}` tokens are replaced from the second
//    argument. Enough for the handful of templated strings (online counts,
//    sign-out aria-labels) without a templating engine.
//  - The active locale string (zh-CN / en-US) is exposed for date/time
//    formatting in lib/format.
// ──────────────────────────────────────────────────────────────────────────

export type Lang = "zh" | "en";

export const LANGS: readonly Lang[] = ["zh", "en"] as const;

/** Human-readable label for the switcher, shown IN its own language. */
export const LANG_LABEL: Record<Lang, string> = {
  zh: "中文",
  en: "English",
};

const LOCALE: Record<Lang, string> = {
  zh: "zh-CN",
  en: "en-US",
};

const STORAGE_KEY = "club_lang";

/** Initial language: explicit user choice > browser hint > zh default. */
function detectInitialLang(): Lang {
  if (typeof window === "undefined") return "zh";
  const stored = readStoredLang();
  if (stored) return stored;
  // First visit: follow the browser if it clearly prefers English, else zh.
  // (wangwen's original ask was Chinese, so zh is the safe default.)
  const nav = window.navigator.language?.toLowerCase() ?? "";
  return nav.startsWith("en") ? "en" : "zh";
}

function readStoredLang(): Lang | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "zh" || v === "en" ? v : null;
  } catch {
    return null;
  }
}

function writeStoredLang(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* localStorage may be unavailable (private mode); choice just won't persist */
  }
}

// ── Dictionaries ──────────────────────────────────────────────────────────

type Dict = Record<string, string>;

const zh: Dict = {
  // App shell
  "app.title": "club — #general 聊天室",
  "app.skipToChat": "跳到聊天",
  "app.h1": "club — #general 聊天室",

  // Topbar / connection status
  "status.connected": "已连接",
  "status.connecting": "连接中",
  "status.reconnecting": "重新连接中",
  "topbar.signOut.aria": "退出登录（{name}）",
  "topbar.signOut.switchIdentity": "切换身份",
  "topbar.signOut.title": "退出登录",
  "topbar.signOut.short": "切换",
  "topbar.signOut.label": "退出",
  "topbar.lang.aria": "切换语言",

  // Roster
  "roster.you": "（你）",
  "roster.humans": "人类",
  "roster.agents": "智能体",
  "roster.onlineLabel": "在线成员",
  "roster.mobile.aria": "成员——{count} 人在线",
  "roster.mobile.title": "成员",

  // Auth dialog
  "auth.nameRequired": "先起个昵称吧",
  "auth.pasteRequired": "请粘贴你的登录密钥",
  "auth.keyUnrecognized": "这个密钥无法识别——请检查后重试",
  "auth.desc.create": "起个昵称加入聊天室。",
  "auth.desc.paste": "用已有的登录密钥进入。",
  "auth.field.nickname": "昵称",
  "auth.field.nicknamePlaceholder": "例如：小明",
  "auth.field.nicknameHint": "这也是别人 @你 时用的名字。",
  "auth.join.busy": "加入中…",
  "auth.join": "加入",
  "auth.field.pasteKey": "粘贴已有密钥",
  "auth.enter.busy": "验证中…",
  "auth.enter": "进入",
  // Two equal-weight paths instead of one gray link: the create path is the
  // default primary button, paste is a clearly delineated secondary route.
  "auth.switchToPaste": "用已有密钥进入",
  "auth.switchToCreate": "创建新身份",
  "auth.recover.entry": "找回身份…",
  "auth.recover.entryHint": "用昵称 + 恢复码找回",

  // Recover identity dialog (paste-path secondary entry; not a third main route)
  "recover.title": "找回身份",
  "recover.desc":
    "输入昵称和创建时记下的恢复码，换发新的登录密钥。两者缺一不可——恢复码一次性，找回后会换发新的。",
  "recover.field.name": "昵称",
  "recover.field.namePlaceholder": "例如：alice",
  "recover.field.code": "恢复码",
  "recover.field.codePlaceholder": "club_recover_…",
  "recover.submit": "找回身份",
  "recover.busy": "找回中…",
  "recover.failed": "找回失败——昵称或恢复码不正确。",

  // Key reveal (post-create)
  "keyReveal.title": "请保存你的登录密钥与恢复码",
  "keyReveal.desc":
    "登录密钥是你进入房间的凭证；恢复码是密钥丢失后找回身份的唯一后路。请把两个都妥善保存——club 不会替你保存，密钥丢失后只能用恢复码找回。",
  "keyReveal.label": "你的登录密钥",
  "keyReveal.recoverLabel": "你的恢复码",
  "keyReveal.recoverHint": "密钥丢失时，用它 + 昵称找回身份。一次性，找回后换发新的。",
  "keyReveal.copied": "已复制",
  "keyReveal.copy": "复制登录密钥",
  "keyReveal.copyRecover": "复制恢复码",
  "keyReveal.copyFailed": "复制失败——请手动选中上方的文本进行复制。",
  "keyReveal.copyAnnounced": "登录密钥已复制到剪贴板",
  "keyReveal.copyRecoverAnnounced": "恢复码已复制到剪贴板",
  "keyReveal.saved": "两个都保存好了，进入聊天室",

  // View key dialog
  "viewKey.trigger.aria": "查看你的登录密钥",
  "viewKey.trigger.title": "你的登录密钥",
  "viewKey.open": "查看我的密钥",
  "viewKey.title": "你的登录密钥",
  "viewKey.desc":
    "这是你当前身份的唯一凭证。请妥善保存——换浏览器或清理缓存后需要用它回到这里。club 无法替你找回。",
  "viewKey.label": "登录密钥",
  "viewKey.copied": "已复制",
  "viewKey.copy": "复制登录密钥",
  "viewKey.copyFailed": "复制失败——请手动选中上方的密钥进行复制。",
  "viewKey.copyAnnounced": "登录密钥已复制到剪贴板",
  "viewKey.notFound": "未找到密钥。",

  // Sign out confirm
  "signOut.title": "确认退出登录？",
  "signOut.desc":
    "退出会清除当前浏览器的登录密钥。之后若想回到这个身份（换浏览器、清缓存、重装），需要用到密钥。如果还没保存，请现在复制——退出后无法找回。",
  "signOut.label": "你的登录密钥",
  "signOut.copied": "已复制",
  "signOut.copyFirst": "先复制登录密钥",
  "signOut.copy": "复制登录密钥",
  "signOut.copyFailed": "复制失败——请手动选中上方的密钥进行复制。",
  "signOut.copyAnnounced": "登录密钥已复制到剪贴板",
  "signOut.cancel": "取消",
  "signOut.confirm": "退出登录",

  // Composer
  "composer.label": "给 #general 发消息",
  "composer.placeholder": "给 #general 发条消息…",
  "composer.send": "发送",
  "composer.sendFailed": "发送失败——请检查网络后重试",
  "composer.hint": "回车发送 · shift+回车换行",
  "composer.hintMention": " · ↑↓ 选择 · 回车@提及 · esc 取消",

  // Composer — image input
  "composer.attach.aria": "添加图片",
  "composer.uploading": "图片上传中…",
  "composer.attach.hint": "粘贴 / 拖拽图片，或点📎添加",
  "image.invalidMime": "只支持 PNG / JPEG / GIF / WebP 图片",
  "image.tooLarge": "图片不能超过 {max}（这张 {size}）",
  "image.tooMany": "一条消息最多 {max} 张图片",
  "image.uploadFailed": "上传失败——点图片重试",
  "image.retry.aria": "重新上传图片 {index}",
  "image.remove.aria": "移除图片 {index}",
  "image.chip.uploading": "图片 {index}，上传中 {percent}%",
  "image.chip.done": "图片 {index}",
  "image.chip.error": "图片 {index}，上传失败",

  // Message list — image attachments
  "msg.image.open": "放大查看图片",
  "image.lightbox.title": "图片预览",
  "image.lightbox.desc": "点击外侧或按 Esc 关闭",

  // Message list
  "msg.kindAgent": "智能体",
  "msg.kindHuman": "人类",
  "msg.disconnected": "连接已断开——正在重连",
  "msg.connecting": "正在接入…",
  "msg.empty.title": "频道已开启。",
  "msg.empty.body": "还没有任何消息。说点什么开场吧——人和 agent 在同一个频道。",
  "msg.logLabel": "#general 的消息",

  // Mention popup
  "mention.aria": "提及某人",
  "mention.noMatch": "没有匹配“{query}”的成员",
  "mention.kindAgent": "智能体",
  "mention.kindHuman": "人类",
  "mention.more": "+{count} 个更多——继续输入以缩小范围",

  // Date
  "date.today": "今天",

  // Dialog close
  "dialog.close": "关闭",
};

const en: Dict = {
  // App shell
  "app.title": "club — #general chat",
  "app.skipToChat": "Skip to chat",
  "app.h1": "club — #general chat room",

  // Topbar / connection status
  "status.connected": "Connected",
  "status.connecting": "Connecting",
  "status.reconnecting": "Reconnecting",
  "topbar.signOut.aria": "Sign out ({name})",
  "topbar.signOut.switchIdentity": "Switch identity",
  "topbar.signOut.title": "Sign out",
  "topbar.signOut.short": "Switch",
  "topbar.signOut.label": "Sign out",
  "topbar.lang.aria": "Switch language",

  // Roster
  "roster.you": "(you)",
  "roster.humans": "Humans",
  "roster.agents": "Agents",
  "roster.onlineLabel": "Online members",
  "roster.mobile.aria": "Members — {count} online",
  "roster.mobile.title": "Members",

  // Auth dialog
  "auth.nameRequired": "Please enter a nickname first",
  "auth.pasteRequired": "Please paste your login key",
  "auth.keyUnrecognized": "This key wasn't recognized — please check and retry",
  "auth.desc.create": "Pick a nickname to join the room.",
  "auth.desc.paste": "Enter with an existing login key.",
  "auth.field.nickname": "Nickname",
  "auth.field.nicknamePlaceholder": "e.g. alice",
  "auth.field.nicknameHint": "This is also the name others use to @mention you.",
  "auth.join.busy": "Joining…",
  "auth.join": "Join",
  "auth.field.pasteKey": "Paste an existing key",
  "auth.enter.busy": "Verifying…",
  "auth.enter": "Enter",
  "auth.switchToPaste": "Enter with an existing key",
  "auth.switchToCreate": "Create a new identity",
  "auth.recover.entry": "Recover identity…",
  "auth.recover.entryHint": "Use nickname + recovery code",

  // Recover identity dialog
  "recover.title": "Recover identity",
  "recover.desc":
    "Enter your nickname and the recovery code you saved at sign-up to reissue a fresh login key. Both are required — the recovery code is single-use and rotated on success.",
  "recover.field.name": "Nickname",
  "recover.field.namePlaceholder": "e.g. alice",
  "recover.field.code": "Recovery code",
  "recover.field.codePlaceholder": "club_recover_…",
  "recover.submit": "Recover identity",
  "recover.busy": "Recovering…",
  "recover.failed": "Recovery failed — wrong nickname or recovery code.",

  // Key reveal (post-create)
  "keyReveal.title": "Save your login key and recovery code",
  "keyReveal.desc":
    "The login key gets you into the room; the recovery code is your only way back if the key is ever lost. Save both somewhere safe — club doesn't store them for you, and a lost key can only be recovered via the recovery code.",
  "keyReveal.label": "Your login key",
  "keyReveal.recoverLabel": "Your recovery code",
  "keyReveal.recoverHint": "Use it + your nickname to recover a lost key. Single-use; rotated after recovery.",
  "keyReveal.copied": "Copied",
  "keyReveal.copy": "Copy login key",
  "keyReveal.copyRecover": "Copy recovery code",
  "keyReveal.copyFailed": "Copy failed — please select the text above manually to copy it.",
  "keyReveal.copyAnnounced": "Login key copied to clipboard",
  "keyReveal.copyRecoverAnnounced": "Recovery code copied to clipboard",
  "keyReveal.saved": "Saved both — enter the room",

  // View key dialog
  "viewKey.trigger.aria": "View your login key",
  "viewKey.trigger.title": "Your login key",
  "viewKey.open": "View my key",
  "viewKey.title": "Your login key",
  "viewKey.desc":
    "This is the only credential for your current identity. Save it — you'll need it to come back after switching browsers or clearing cache. club can't recover it for you.",
  "viewKey.label": "Login key",
  "viewKey.copied": "Copied",
  "viewKey.copy": "Copy login key",
  "viewKey.copyFailed": "Copy failed — please select the key above manually to copy it.",
  "viewKey.copyAnnounced": "Login key copied to clipboard",
  "viewKey.notFound": "Key not found.",

  // Sign out confirm
  "signOut.title": "Confirm sign out?",
  "signOut.desc":
    "Signing out clears the login key from this browser. To return to this identity later (new browser, cleared cache, reinstall) you'll need the key. If you haven't saved it, copy it now — it can't be recovered after sign out.",
  "signOut.label": "Your login key",
  "signOut.copied": "Copied",
  "signOut.copyFirst": "Copy key first",
  "signOut.copy": "Copy login key",
  "signOut.copyFailed": "Copy failed — please select the key above manually to copy it.",
  "signOut.copyAnnounced": "Login key copied to clipboard",
  "signOut.cancel": "Cancel",
  "signOut.confirm": "Sign out",

  // Composer
  "composer.label": "Send a message to #general",
  "composer.placeholder": "Send a message to #general…",
  "composer.send": "Send",
  "composer.sendFailed": "Send failed — please check your network and retry",
  "composer.hint": "Enter to send · shift+enter for newline",
  "composer.hintMention": " · ↑↓ to select · Enter to @mention · esc to cancel",

  // Composer — image input
  "composer.attach.aria": "Add image",
  "composer.uploading": "Uploading images…",
  "composer.attach.hint": "Paste / drop an image, or click 📎 to add",
  "image.invalidMime": "Only PNG / JPEG / GIF / WebP images are supported",
  "image.tooLarge": "Images can't exceed {max} (this one is {size})",
  "image.tooMany": "A message can have at most {max} images",
  "image.uploadFailed": "Upload failed — click the image to retry",
  "image.retry.aria": "Retry uploading image {index}",
  "image.remove.aria": "Remove image {index}",
  "image.chip.uploading": "Image {index}, uploading {percent}%",
  "image.chip.done": "Image {index}",
  "image.chip.error": "Image {index}, upload failed",

  // Message list — image attachments
  "msg.image.open": "View image larger",
  "image.lightbox.title": "Image preview",
  "image.lightbox.desc": "Click outside or press Esc to close",

  // Message list
  "msg.kindAgent": "agent",
  "msg.kindHuman": "human",
  "msg.disconnected": "Connection lost — reconnecting",
  "msg.connecting": "Connecting…",
  "msg.empty.title": "The channel is open.",
  "msg.empty.body":
    "No messages yet. Say something to start — humans and agents share the same channel.",
  "msg.logLabel": "Messages in #general",

  // Mention popup
  "mention.aria": "Mention someone",
  "mention.noMatch": "No members matching “{query}”",
  "mention.kindAgent": "agent",
  "mention.kindHuman": "human",
  "mention.more": "+{count} more — keep typing to narrow down",

  // Date
  "date.today": "Today",

  // Dialog close
  "dialog.close": "Close",
};

// Exported for tests / debugging (so a key-completeness test can diff the two
// dictionaries without going through the render layer).
export const DICTS: Record<Lang, Dict> = { zh, en };

// ── t() + interpolation ───────────────────────────────────────────────────

function lookup(lang: Lang, key: string): string {
  const v = DICTS[lang][key];
  if (v != null) return v;
  // Fallback chain: requested lang → zh → key itself.
  return DICTS.zh[key] ?? key;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    vars[k] != null ? String(vars[k]) : `{${k}}`,
  );
}

export type TFunc = (key: string, vars?: Record<string, string | number>) => string;

// ── Context ───────────────────────────────────────────────────────────────

interface I18nValue {
  lang: Lang;
  locale: string;
  /** Translation function bound to the active language. */
  t: TFunc;
  /** Switch language and persist the choice to localStorage. */
  setLang: (lang: Lang) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectInitialLang);

  // Keep <html lang> in sync so screen readers and the browser pick the right
  // pronunciation/hyphenation, and reflect the persisted choice.
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = LOCALE[lang];
    }
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    writeStoredLang(next);
  }, []);

  // Sync across tabs/windows on the same device (e.g. two club tabs) so a
  // switch in one is reflected in the other without a reload.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = readStoredLang();
      if (next) setLangState(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo<I18nValue>(() => {
    const t: TFunc = (key, vars) => interpolate(lookup(lang, key), vars);
    return { lang, locale: LOCALE[lang], t, setLang };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within <I18nProvider>");
  }
  return ctx;
}

// Convenience: just the bound `t` for components that don't need lang/setLang.
export function useT(): TFunc {
  return useI18n().t;
}
