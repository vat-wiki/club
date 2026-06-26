# ux-patrol round 1 — scrollable-region-focusable a11y

**日期**: 2026-06-26
**范围**: `packages/web` 纯前端（可访问性视角）
**上轮**: round 0（commit `c6489ac`，消息列表可读性 P0，已验证通过）

## 本轮做了什么

1. **复验 round 0** — 确认 `c6489ac` 已落盘、50 测试绿、round 0 的 P0 改动在产线 DOM 上生效（own 行 `flex-row-reverse`、self-mention 品牌色 + 行级 wash）。无回归。
2. **收 round-0 待办 #1** — 修复 pre-existing 的 axe `[scrollable-region-focusable]` 违规（round 0 用 `git stash` 对照确认是 baseline 即存在、非本轮引入）。

## 改动

两个滚动容器原本有 `overflow-y: auto` + 无障碍名称但缺 `tabindex`，键盘用户无法聚焦后用方向键独立滚动。标准修复（WCAG 2.1.1 + axe `scrollable-region-focusable`）：

- `packages/web/src/components/message-list.tsx` — 消息 `role="log"` 容器加 `tabIndex={0}` + `focus-visible:ring-1 ring-inset ring-ring/40`。
- `packages/web/src/components/roster.tsx` — 成员 `<aside>` 加 `tabIndex={0}` + 同款 focus ring。

> **透明说明**：`roster.tsx` 还顺带落了两处**工作树中既有的未提交视觉微调**（非本轮新做，但 `git add` 是文件级，无法只挑行分离）：
> - `Row` hover `bg-accent/40 → /70`（与消息列表 hover 强度对齐）
> - `<aside>` 背景 `bg-card → bg-chrome`（与 composer/topbar 表面色统一）
>
> 两处均为良性视觉一致性改动，已在 commit message 注明。

## 验证（headless chromium + axe-core，登录为 test_1）

- **页面级 axe WCAG 2.1 A/AA：0 违规**（round 0 时为 1 条 pre-existing `[scrollable-region-focusable]`，现已消除，且零新增违规）。
- **`scrollable-region-focusable` 专项：0 违规**。
- DOM 取证：`[role=log]` 与 `<aside>` 的 `tabindex` 均渲染为 `"0"`，`aria-label` 保留（`Messages in #general` / `Members online`）。
- `npm -w @club/web run typecheck` — 通过。
- `npm -w @club/web run test` — **50 passed / 4 files**。

## 本轮视角（可访问性）顺手发现的 P2（未实现，记录备查）

读 `composer.tsx` / `mention-popup.tsx`（round 0 未碰、历史截图未覆盖的新功能）时发现的小 a11y 点，影响小，留给后续：

- **composer combobox 缺 `aria-haspopup="listbox"`**（`composer.tsx`）— 已有 `aria-expanded/controls/activedescendant`，补 `aria-haspopup="listbox"` 更完整。
- **mention 空状态 `<li role="presentation">`**（`mention-popup.tsx`）— `role="presentation"` 会让 SR 忽略「no one matches」提示；空状态用普通 `<li>` 或加 `role="status"` 更友好。

## 遗留待办（继承自 round 0 + 本轮）

1. **移动端 topbar 20px 水平溢出（pre-existing）** — 来自 sign-out 按钮 + 图标，工作树 `topbar.tsx` 已被改。留给 topbar 专项那轮。
2. **气泡圆角/间距/微动效** — 建议交「王设计」系统评估（own 气泡稍深 primary、入场上推动画等）。
3. **`max-w-[44ch]` 阈值** — 经验值，CJK + 长英文混排后续观察是否 token 化。
4. （本轮新增 P2）composer `aria-haspopup`、mention 空状态 `role` — 见上。

## commit

`fix(web): ux-patrol round 1 - scrollable-region-focusable a11y`（本地，**未 push**）
