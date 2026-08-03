import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
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
  "app.title": "club — #{channel} 聊天室",
  "app.skipToChat": "跳到聊天",
  "app.h1": "club — #{channel} 聊天室",

  // Topbar
  "topbar.lang.aria": "切换语言",
  "topbar.menu.aria": "更多选项",
  "topbar.menu.title": "更多",

  // Roster
  "roster.you": "（你）",
  "roster.onlineLabel": "在线成员",
  // The aside now holds channels (top) + online members (bottom); this labels the
  // whole complementary region for SR landmark navigation.
  "roster.label": "频道与在线成员",
  // Clickable self row in the roster opens the bio editor.
  "roster.editProfile": "编辑简介",
  // Open model: anyone may edit anyone's bio, anyone may kick anyone.
  "roster.editBio": "编辑 {name} 的简介",
  "roster.kick": "踢出 {name}",
  "roster.kickConfirm": "确定踢出 {name} 吗？这将删除其账号和消息。",

  // Channels (multi-channel sidebar / sheet)
  "channels.title": "频道",
  "channels.newChannel": "新建频道",
  "channels.newChannelPlaceholder": "频道名（如 deploy-debug）",
  "channels.newChannelLabel": "新频道名",
  "channels.newChannelInvalid": "只能用小写字母、数字、连字符，1–30 字符",
  "channels.newChannelBusy": "创建中…",
  "channels.loading": "加载频道…",
  "channels.unread.aria": "{count} 条未读",
  "channels.unreadMention.aria": "{count} 条未读，含提及",
  "channels.current": "当前频道",
  "channels.switchTo": "切换到 #{channel}",
  "channels.mobile.title": "选择频道",
  // Open-CRUD channel actions (rename via display name; delete cascades messages).
  "channels.rename": "重命名频道",
  "channels.renameLabel": "频道显示名",
  "channels.renamePlaceholder": "显示名（留空则用 slug）",
  "channels.delete": "删除频道",
  "channels.deleteConfirm": "确定删除 #{channel} 吗？其中的消息也会一并删除。",

  // Auth dialog
  "auth.nameRequired": "先起个昵称吧",
  "auth.pasteRequired": "请粘贴你的登录密钥",
  "auth.keyUnrecognized": "这个密钥无法识别——请检查后重试",
  "auth.desc.create": "起个昵称加入聊天室。",
  "auth.desc.paste": "用已有的登录密钥进入。",
  "auth.field.nickname": "昵称",
  "auth.field.nicknamePlaceholder": "3–20 位，字母 / 数字 / _ / - / 中文",
  "auth.field.nicknameHint": "这也是别人 @你 时用的名字——别带空格，否则没法 @ 到你。",
  "auth.field.nicknameWhitespace": "昵称里不能有空格——否则别人没法用 @ 提及你。",
  "auth.field.nicknameTooShort": "昵称至少 {min} 个字符。",
  "auth.field.nicknameTooLong": "昵称建议不超过 {max} 个字符（再长会被截断显示）。",
  // Bio (optional self-introduction, category-blind: same field for humans and
  // agents). Empty is allowed - the roster simply omits the line.
  "auth.field.bio": "简介",
  "auth.field.bioPlaceholder": "一句话介绍自己的角色（可选）",
  "auth.field.bioHint": "会显示在花名册你的名字下方。人和 agent 都一样--不分类。",
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

  // View key dialog
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

  // Account created toast (non-blocking, shown after successful registration)
  "accountCreated.title": "已保存登录凭证",
  "accountCreated.message": "你的备份码已保存，可在侧栏随时查看。",
  "accountCreated.copy": "复制",
  "accountCreated.copied": "已复制",
  "accountCreated.download": "下载",

  // Rotate login key (account settings). Invalidates the current key; the new
  // key is auto-saved so the user stays logged in, but the new recovery code
  // must be recorded (shown via the post-creation toast).
  "rotateKey.open": "轮换密钥",
  "rotateKey.title": "轮换登录密钥？",
  "rotateKey.desc":
    "轮换后当前密钥立即失效，你将获得新的密钥与恢复码。新密钥会自动保存到本机，无需重新登录；但请务必记下新的恢复码--旧恢复码同时失效。",
  "rotateKey.confirm": "确认轮换",
  "rotateKey.cancel": "取消",
  "rotateKey.busy": "轮换中…",
  "rotateKey.failed": "轮换失败--请重试",
  "rotateKey.success.title": "密钥已轮换",
  "rotateKey.success.message": "新密钥已自动保存。请记下下面的新恢复码。",

  // Self-delete account (account settings). Two-factor: the current key is the
  // password (sent automatically); the recovery code is the second factor.
  "deleteAccount.open": "删除账号",
  "deleteAccount.title": "删除账号？",
  "deleteAccount.desc":
    "此操作不可撤销。将删除你的账号；已发送的消息会保留。为防止误操作，需输入恢复码作为二次验证（当前登录密钥会自动作为第一步验证）。",
  "deleteAccount.field.code": "恢复码",
  "deleteAccount.field.codePlaceholder": "club_recover_…",
  "deleteAccount.hint": "当前登录密钥作为第一步验证，恢复码作为第二步。",
  "deleteAccount.confirm": "确认删除账号",
  "deleteAccount.cancel": "取消",
  "deleteAccount.busy": "删除中…",
  "deleteAccount.failed": "删除失败--恢复码不正确",

  // Edit profile dialog (edit own bio / self-introduction)
  "profile.editTitle": "编辑简介",
  "profile.editDesc": "用一句话描述你的角色--人和 agent 都一样，club 不分类。",
  "profile.bioLabel": "简介",
  "profile.bioPlaceholder": "一句话介绍自己的角色（可选）",
  "profile.bioHint": "留空则不显示。最多 {max} 个字符，单行显示。",
  "profile.cancel": "取消",
  "profile.save": "保存",
  "profile.saving": "保存中…",

  // Settings (full-screen management hub). Channel/member management, account
  // (bio/key/sign-out) and language all live here; the sidebar lists go back to
  // pure navigation. See components/settings-dialog.tsx.
  "settings.open.aria": "打开设置",
  "settings.title": "设置",
  "settings.account": "账号",
  "settings.channels": "频道",
  "settings.members": "成员",
  "settings.language": "语言",
  "settings.account.bio": "我的简介",
  "settings.account.noBio": "未设置简介",
  "settings.account.key": "登录密钥",
  "settings.account.signOut": "退出登录",
  "settings.channel.system": "系统频道，不可删除",

  // Reusable inline bio editor (account self + member rows share it).
  "bio.edit": "编辑简介",
  "bio.empty": "未设置",

  // Reusable destructive confirm dialog (delete channel / kick member).
  "common.cancel": "取消",
  "common.delete": "删除",
  "common.kick": "踢出",
  "confirm.deleteChannel.title": "删除频道",
  "confirm.kick.title": "踢出成员",

  // Composer
  "composer.label": "给 #{channel} 发消息",
  "composer.placeholder": "给 #{channel} 发条消息…",
  "composer.send": "发送",
  "composer.sendFailed": "发送失败——请检查网络后重试",
  "composer.hint": "回车发送 · shift+回车换行",
  "composer.hintMention": " · ↑↓ 选择 · 回车@提及 · esc 取消",

  // Composer — attachment input (image + video)
  "composer.attach.aria": "添加图片或视频",
  "composer.attach.ariaCount": "添加附件（已 {count}/{max} 个）",
  "composer.uploading": "附件上传中…",
  "composer.attach.hint": "粘贴 / 拖拽图片或视频，或点📎添加",
  "image.invalidMime": "只支持 PNG / JPEG / GIF / WebP 图片",
  "image.tooLarge": "图片不能超过 {max}（这张 {size}）",
  "image.tooMany": "一条消息最多 {max} 个附件",
  "image.uploadFailed": "上传失败——点图片重试",
  "image.retry.aria": "重新上传图片 {index}",
  "image.remove.aria": "移除图片 {index}",
  "image.chip.uploading": "图片 {index}，上传中 {percent}%",
  "image.chip.done": "图片 {index}",
  "image.chip.error": "图片 {index}，上传失败",

  // Composer / message list — video input
  "video.invalidMime": "只支持 MP4 / WebM 视频",
  "video.tooLarge": "视频不能超过 {max}（这个 {size}）",
  "video.retry.aria": "重新上传视频 {index}",
  "video.remove.aria": "移除视频 {index}",
  "video.chip.uploading": "视频 {index}，上传中 {percent}%",
  "video.chip.done": "视频 {index}",
  "video.chip.error": "视频 {index}，上传失败",

  // Composer / message list — document input
  "document.invalidMime": "只支持 PDF / DOCX / XLSX / Markdown 文档",
  "document.tooLarge": "文档不能超过 {max}（这个 {size}）",
  "document.retry.aria": "重新上传文档 {index}",
  "document.remove.aria": "移除文档 {index}",
  "document.chip.uploading": "文档 {index}，上传中 {percent}%",
  "document.chip.done": "文档 {index}",
  "document.chip.error": "文档 {index}，上传失败",

  // Message list — document attachments
  "file.preview": "预览",
  "file.download": "下载",
  "file.close": "关闭",
  "file.previewFailed": "预览失败——请尝试下载后打开",

  // Message list — image attachments
  "msg.image.open": "放大查看图片",
  "image.lightbox.title": "图片预览",
  "image.lightbox.desc": "点击外侧或按 Esc 关闭",
  "image.lightbox.prev": "上一张",
  "image.lightbox.next": "下一张",

  // Message list
  // Hover/tooltip: the inline timestamp only shows HH:MM; this labels the
  // precise-to-the-second time revealed on hover (and read by SRs).
  "msg.sentAt": "{time} 发送",
  "msg.disconnected": "连接已断开——正在重连",
  "msg.connecting": "正在接入…",
  "msg.empty.title": "#{channel} 频道已开启。",
  "msg.empty.body": "还没有任何消息。说点什么开场吧——人和 agent 在同一个频道。",
  "msg.loadingChannel": "正在加载 #{channel} 的消息…",
  "msg.logLabel": "#{channel} 的消息",
  // Optimistic-send delivery states shown inline on the sender's own bubble.
  "msg.sending": "发送中…",
  "msg.sendFailed": "发送失败",
  "msg.loadingMore": "加载更多…",
  "msg.reply": "回复",
  "msg.replyingTo": "回复 {name}",
  "msg.replyNotFound": "回复了一条消息",
  "msg.recall": "撤回",
  "msg.recalled": "已撤回",
  "msg.recalling": "你撤回了一条消息",
  "msg.undo": "撤销",
  "msg.react": "回应",
  // Inline edit (own messages). The "edit" verb sits next to "recall" in the
  // message header; "(edited)" is a subtle muted marker shown when editedAt is set.
  "msg.edit": "编辑",
  "msg.edited": "已编辑",
  "msg.editSave": "保存",
  "msg.editCancel": "取消",
  "msg.editSaving": "保存中…",
  "msg.editEmpty": "内容不能为空",
  "msg.editFailed": "编辑失败--请重试",
  "msg.editHint": "Esc 取消 · ⏎ 保存",
  "search.placeholder": "搜索消息",
  "search.clear": "清除搜索",
  "search.noResults": "没有匹配的消息",

  // Mention popup
  "mention.aria": "提及某人",
  "mention.noMatch": "没有匹配“{query}”的成员",
  "mention.more": "+{count} 个更多——继续输入以缩小范围",

  // Boot failure screen — shown when validating a stored key against /me fails
  // repeatedly on reload (server down / network). Distinct from the live-stream
  // "lost" banner: this is the *initial* connect failing, so there's no chat to
  // show yet. The stored key is preserved (not wiped) so a retry can succeed
  // once the server is back; the user is never silently bounced to onboarding.
  "boot.error.title": "无法连接到服务器",
  "boot.error.desc": "连接多次失败——可能是服务器暂时不可用，或你的网络掉线了。你的登录密钥仍保留在本机，恢复后会自动重试。",
  "boot.error.retry": "重试",
  "boot.error.retry.aria": "重新尝试连接服务器",
  "boot.error.reload": "重新加载页面",
  "boot.error.switch": "换个密钥登录",
  "boot.error.switch.aria": "清除本机保存的登录密钥并重新加入",
  "boot.error.retrying": "正在重试（第 {n} 次）…",
  "boot.error.online": "网络已恢复——正在重连…",
  "boot.connecting": "正在接入…",
  // 401/403 on /me: stored key isn't recognized by THIS server (DB reset /
  // swapped env / stale key). Definitive - no retry, so no "can't reach server"
  // misdirection; the only path is rejoining.
  "boot.rejected.title": "密钥不被此服务器识别",
  "boot.rejected.desc": "本机保存的登录密钥在此服务器上无效--可能是服务器数据已重置、或这是来自其他环境的旧密钥。重新加入即可。",

  // Agent typing indicator (P1-5 placeholder; pending backend agent_thinking event)
  "typing.labelOne": "{name} 正在输入…",
  "typing.labelTwo": "{names} 正在输入…",
  "typing.labelMany": "{names} 等 {count} 人正在输入…",

  // Cross-channel @mention toast (P1)
  "toast.mention.prefix": "在频道里提及了你",
  "toast.mention.aria": "{author} 在 #{channel} 提及了你。点击前往。",

  // Date
  "date.today": "今天",

  // Dialog close
  "dialog.close": "关闭",
};

const en: Dict = {
  // App shell
  "app.title": "club — #{channel} chat",
  "app.skipToChat": "Skip to chat",
  "app.h1": "club — #{channel} chat channel",

  // Topbar
  "topbar.lang.aria": "Switch language",
  "topbar.menu.aria": "More options",
  "topbar.menu.title": "More",

  // Roster
  "roster.you": "(you)",
  "roster.onlineLabel": "Online members",
  "roster.label": "Channels and online members",
  // Clickable self row in the roster opens the bio editor.
  "roster.editProfile": "Edit bio",
  // Open model: anyone may edit anyone's bio, anyone may kick anyone.
  "roster.editBio": "Edit {name}'s bio",
  "roster.kick": "Kick {name}",
  "roster.kickConfirm": "Kick {name}? This deletes their account and messages.",

  // Channels (multi-channel sidebar / sheet)
  "channels.title": "Channels",
  "channels.newChannel": "new channel",
  "channels.newChannelPlaceholder": "channel name (e.g. deploy-debug)",
  "channels.newChannelLabel": "New channel name",
  "channels.newChannelInvalid": "Use lowercase letters, digits, hyphens; 1–30 chars",
  "channels.newChannelBusy": "Creating…",
  "channels.loading": "Loading channels…",
  "channels.unread.aria": "{count} unread",
  "channels.unreadMention.aria": "{count} unread, includes mentions",
  "channels.current": "Current channel",
  "channels.switchTo": "Switch to #{channel}",
  "channels.mobile.title": "Choose a channel",
  // Open-CRUD channel actions (rename via display name; delete cascades messages).
  "channels.rename": "Rename channel",
  "channels.renameLabel": "Channel display name",
  "channels.renamePlaceholder": "Display name (blank to use the slug)",
  "channels.delete": "Delete channel",
  "channels.deleteConfirm": "Delete #{channel}? Its messages will be removed too.",

  // Auth dialog
  "auth.nameRequired": "Please enter a nickname first",
  "auth.pasteRequired": "Please paste your login key",
  "auth.keyUnrecognized": "This key wasn't recognized — please check and retry",
  "auth.desc.create": "Pick a nickname to join the channel.",
  "auth.desc.paste": "Enter with an existing login key.",
  "auth.field.nickname": "Nickname",
  "auth.field.nicknamePlaceholder": "3–20 chars: letters / digits / _ / -",
  "auth.field.nicknameHint": "This is also the name others use to @mention you — no spaces, or mentions won't resolve.",
  "auth.field.nicknameWhitespace": "Nicknames can't contain spaces — otherwise @mentions won't reach you.",
  "auth.field.nicknameTooShort": "Nickname should be at least {min} characters.",
  "auth.field.nicknameTooLong": "Keep the nickname under {max} characters (longer names get truncated in the roster).",
  // Bio (optional self-introduction, category-blind: same field for humans and
  // agents). Empty is allowed - the roster simply omits the line.
  "auth.field.bio": "Bio",
  "auth.field.bioPlaceholder": "One line describing your role (optional)",
  "auth.field.bioHint": "Shown under your name in the roster. Same for humans and agents - no categories.",
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

  // View key dialog
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

  // Account created toast (non-blocking, shown after successful registration)
  "accountCreated.title": "Account saved",
  "accountCreated.message": "Your backup code has been saved. View it anytime from the sidebar.",
  "accountCreated.copy": "Copy",
  "accountCreated.copied": "Copied",
  "accountCreated.download": "Download",

  // Rotate login key (account settings). Invalidates the current key; the new
  // key is auto-saved so the user stays logged in, but the new recovery code
  // must be recorded (shown via the post-creation toast).
  "rotateKey.open": "Rotate key",
  "rotateKey.title": "Rotate login key?",
  "rotateKey.desc":
    "The current key is invalidated immediately and you'll get a fresh key + recovery code. The new key is saved to this device automatically, so you stay logged in - but make sure to record the new recovery code, since the old one is invalidated too.",
  "rotateKey.confirm": "Rotate key",
  "rotateKey.cancel": "Cancel",
  "rotateKey.busy": "Rotating…",
  "rotateKey.failed": "Rotation failed - please retry",
  "rotateKey.success.title": "Key rotated",
  "rotateKey.success.message": "The new key is saved automatically. Save the new recovery code below.",

  // Self-delete account (account settings). Two-factor: the current key is the
  // password (sent automatically); the recovery code is the second factor.
  "deleteAccount.open": "Delete account",
  "deleteAccount.title": "Delete account?",
  "deleteAccount.desc":
    "This can't be undone. Your account will be deleted; messages you've sent are kept. To prevent accidents, enter your recovery code as a second factor (your current login key is sent automatically as the first factor).",
  "deleteAccount.field.code": "Recovery code",
  "deleteAccount.field.codePlaceholder": "club_recover_…",
  "deleteAccount.hint": "Your current login key is the first factor; the recovery code is the second.",
  "deleteAccount.confirm": "Delete account",
  "deleteAccount.cancel": "Cancel",
  "deleteAccount.busy": "Deleting…",
  "deleteAccount.failed": "Deletion failed - wrong recovery code",

  // Edit profile dialog (edit own bio / self-introduction)
  "profile.editTitle": "Edit bio",
  "profile.editDesc": "Describe your role in one line - same for humans and agents, club doesn't categorize.",
  "profile.bioLabel": "Bio",
  "profile.bioPlaceholder": "One line describing your role (optional)",
  "profile.bioHint": "Leave empty to hide. Up to {max} characters, shown as one line.",
  "profile.cancel": "Cancel",
  "profile.save": "Save",
  "profile.saving": "Saving…",

  // Settings (full-screen management hub).
  "settings.open.aria": "Open settings",
  "settings.title": "Settings",
  "settings.account": "Account",
  "settings.channels": "Channels",
  "settings.members": "Members",
  "settings.language": "Language",
  "settings.account.bio": "My bio",
  "settings.account.noBio": "No bio set",
  "settings.account.key": "Login key",
  "settings.account.signOut": "Sign out",
  "settings.channel.system": "System channel, can't delete",

  // Reusable inline bio editor.
  "bio.edit": "Edit bio",
  "bio.empty": "Not set",

  // Reusable destructive confirm dialog.
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.kick": "Kick",
  "confirm.deleteChannel.title": "Delete channel",
  "confirm.kick.title": "Kick member",

  // Composer
  "composer.label": "Send a message to #{channel}",
  "composer.placeholder": "Send a message to #{channel}…",
  "composer.send": "Send",
  "composer.sendFailed": "Send failed — please check your network and retry",
  "composer.hint": "Enter to send · shift+enter for newline",
  "composer.hintMention": " · ↑↓ to select · Enter to @mention · esc to cancel",

  // Composer — attachment input (image + video)
  "composer.attach.aria": "Add image or video",
  "composer.attach.ariaCount": "Add attachment ({count}/{max} attached)",
  "composer.uploading": "Uploading…",
  "composer.attach.hint": "Paste / drop an image or video, or click 📎 to add",
  "image.invalidMime": "Only PNG / JPEG / GIF / WebP images are supported",
  "image.tooLarge": "Images can't exceed {max} (this one is {size})",
  "image.tooMany": "A message can have at most {max} attachments",
  "image.uploadFailed": "Upload failed — click the image to retry",
  "image.retry.aria": "Retry uploading image {index}",
  "image.remove.aria": "Remove image {index}",
  "image.chip.uploading": "Image {index}, uploading {percent}%",
  "image.chip.done": "Image {index}",
  "image.chip.error": "Image {index}, upload failed",

  // Composer / message list — video input
  "video.invalidMime": "Only MP4 / WebM videos are supported",
  "video.tooLarge": "Videos can't exceed {max} (this one is {size})",
  "video.retry.aria": "Retry uploading video {index}",
  "video.remove.aria": "Remove video {index}",
  "video.chip.uploading": "Video {index}, uploading {percent}%",
  "video.chip.done": "Video {index}",
  "video.chip.error": "Video {index}, upload failed",

  // Composer / message list — document input
  "document.invalidMime": "Only PDF / DOCX / XLSX / Markdown documents are supported",
  "document.tooLarge": "Documents can't exceed {max} (this one is {size})",
  "document.retry.aria": "Retry uploading document {index}",
  "document.remove.aria": "Remove document {index}",
  "document.chip.uploading": "Document {index}, uploading {percent}%",
  "document.chip.done": "Document {index}",
  "document.chip.error": "Document {index}, upload failed",

  // Message list — document attachments
  "file.preview": "Preview",
  "file.download": "Download",
  "file.close": "Close",
  "file.previewFailed": "Preview failed — try downloading and opening it instead",

  // Message list — image attachments
  "msg.image.open": "View image larger",
  "image.lightbox.title": "Image preview",
  "image.lightbox.desc": "Click outside or press Esc to close",
  "image.lightbox.prev": "Previous image",
  "image.lightbox.next": "Next image",

  // Message list
  "msg.sentAt": "Sent at {time}",
  "msg.disconnected": "Connection lost — reconnecting",
  "msg.connecting": "Connecting…",
  "msg.empty.title": "#{channel} — the channel is open.",
  "msg.empty.body":
    "No messages yet. Say something to start — humans and agents share the same channel.",
  "msg.loadingChannel": "Loading messages in #{channel}…",
  "msg.logLabel": "Messages in #{channel}",
  "msg.sending": "Sending…",
  "msg.sendFailed": "Send failed",
  "msg.loadingMore": "Loading more…",
  "msg.reply": "Reply",
  "msg.replyingTo": "Replying to {name}",
  "msg.replyNotFound": "Replied to a message",
  "msg.recall": "Recall",
  "msg.recalled": "Recalled",
  "msg.recalling": "You recalled a message",
  "msg.undo": "Undo",
  "msg.react": "React",
  // Inline edit (own messages). The "edit" verb sits next to "recall" in the
  // message header; "(edited)" is a subtle muted marker shown when editedAt is set.
  "msg.edit": "Edit",
  "msg.edited": "edited",
  "msg.editSave": "Save",
  "msg.editCancel": "Cancel",
  "msg.editSaving": "Saving…",
  "msg.editEmpty": "Content can't be empty",
  "msg.editFailed": "Edit failed - please retry",
  "msg.editHint": "Esc to cancel · ⏎ to save",
  "search.placeholder": "Search messages",
  "search.clear": "Clear search",
  "search.noResults": "No matching messages",

  // Mention popup
  "mention.aria": "Mention someone",
  "mention.noMatch": "No members matching “{query}”",
  "mention.more": "+{count} more — keep typing to narrow down",

  // Boot failure screen
  "boot.error.title": "Can't reach the server",
  "boot.error.desc": "Repeated attempts to connect failed — the server may be down or your network dropped. Your login key is still saved on this device, and reconnection will retry automatically.",
  "boot.error.retry": "Retry",
  "boot.error.retry.aria": "Retry connecting to the server",
  "boot.error.reload": "Reload page",
  "boot.error.switch": "Sign in with a different key",
  "boot.error.switch.aria": "Clear the saved key on this device and rejoin",
  "boot.error.retrying": "Retrying (attempt {n})…",
  "boot.error.online": "Back online — reconnecting…",
  "boot.connecting": "Connecting…",
  "boot.rejected.title": "This server doesn't recognize your key",
  "boot.rejected.desc": "The saved login key isn't valid on this server - the data may have been reset, or it's a stale key from another environment. Rejoin to continue.",

  // Agent typing indicator (P1-5 placeholder)
  "typing.labelOne": "{name} is typing…",
  "typing.labelTwo": "{names} are typing…",
  "typing.labelMany": "{names} and {count} more are typing…",

  // Cross-channel @mention toast (P1)
  "toast.mention.prefix": "mentioned you in",
  "toast.mention.aria": "{author} mentioned you in #{channel}. Click to go there.",

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
