# ux-patrol round 0 — baseline (消息列表可读性 P0)

**日期**: 2026-06-26
**范围**: `packages/web` 纯前端
**对应评审**: 王体验消息列表体验评审报告（截图见 `.claude/ux-review/msg-*.png`）

## 本轮解决了什么

两个被评审确认的 P0 可读性问题：

1. **自己 / 别人发的消息几乎没视觉区分**
   根因：`message-list.tsx` 的 `MessageRow` 里 `self && ""` 永远是空串，`self` prop 没作用在任何样式上。
2. **@自己 和 @别人 高亮颜色完全一样**
   根因：`format.tsx` 的 `renderContent` 只接收 `known` 列表，不知道当前用户是谁。

## 改动（P0-1 + P0-2 两层）

### P0-1 自己/别人消息视觉区分（气泡 + 对齐方案）
- 自己的消息：靠右对齐（外层 `flex-row-reverse`）；正文包一个气泡，`bg-primary/15`（薄荷绿 15%，呼应 agent 品牌色）+ `text-foreground`。
- 别人的消息：保持靠左；正文气泡用 `bg-card`（raised surface token）。
- 作者类型圆点（kind dot）随对齐方向翻转：self 时在右侧，否则在左侧，不会出现「右对齐了但圆点还在左边」的别扭。
- 作者名行 self 时整体 `flex-row-reverse`，时间戳挪到右边。
- 气泡加 `max-w-[min(100%,44ch)]` 控制可读宽度，移动端自然收窄。
- 弃用了原来只有 10% 不透明度差异的弱区分（`text-foreground` vs `text-foreground/90`）。

### P0-2 第一层：self-mention 换色
- `renderContent(content, known, selfName?)` 新增可选 `selfName` 参数。
- 当 `handle.toLowerCase() === selfName?.toLowerCase()` 时，渲染成品牌色高亮而非琥珀：
  `bg-primary/25 text-primary font-medium`，并给 `<mark>` 加左侧 `border-l-2 border-primary` 小竖线拉开层级。
- a11y：浏览器级 axe `color-contrast` 在消息区域 0 违规，薄荷绿在 graphite 背景上达 AA（普通文本 ≥ 4.5:1）。

### P0-2 第二层：行级信号
- 新增纯函数 `mentionsSelf(content, selfName?)`：`content.toLowerCase().includes("@" + selfName.toLowerCase())`，大小写不敏感（与服务端 mention 解析语义一致）。
- `MessageRow` 命中时整行加 `bg-primary/5` 背景 + 左侧 `border-l-2 border-l-primary/40` 竖条，即使滚动中也能一眼看到「这条 @ 我了」。
- 在 `MessageList` 调用 `renderContent` 处把 `me?.name` 透传给 `selfName`。

## 改了哪些文件

- `packages/web/src/lib/format.tsx` — `renderContent` 加 `selfName` 参数 + self-mention 品牌色分支；新增 `mentionsSelf` 纯函数。
- `packages/web/src/components/message-list.tsx` — `MessageRow` 改为气泡 + 对齐方案，新增 `selfName`/`pinged` 信号；`MessageList` 透传 `me?.name`。
- `packages/web/src/lib/format.test.tsx` — 补 self-mention 换色、case-insensitive、unknown 不高亮等用例；新增 `mentionsSelf` 的单测。
- `packages/web/src/components/message-list.test.tsx`（新增）— 行级覆盖：own vs other 对齐/气泡色、self-mention 行级 wash、inline mark 调色板。

## 验证

- `npm -w @club/web run typecheck` — 通过。
- `npm -w @club/web run test` — 50 passed / 4 files。
- 浏览器验证（playwright-cli，登录为 `test_1`）：
  - 桌面端截图 `round0-desktop-final.png`、`round0-desktop-after.png`。
  - 移动端 (390×844) 截图 `round0-mobile-final.png`。
  - DOM 类名取证（load-bearing）：
    - `test_1` 自己的消息行 → `... flex-row-reverse`（右对齐）✓
    - `ux_reviewer_tmp` 发的 `@test_1 你好...` 行 → `... border-l-2 border-l-primary/40 bg-primary/5`（行级 wash）✓
    - `@test_1` 的 `<mark>` → `bg-primary/25 text-primary border-l-2 border-primary`（品牌色）✓
    - `@xxa`/`@alice`/`@ux_reviewer_tmp`/`@tester` 的 `<mark>` → `bg-human-soft text-human`（琥珀）✓
  - 移动端零行级水平溢出（per-row `scrollWidth > clientWidth` 计数为 0）。
- 页面级 axe（WCAG 2.1 A/AA）：
  - **消息区域 `color-contrast` 0 违规** —— 自证换色后对比度达标。
  - 全页 1 条违规 `[scrollable-region-focusable]`（aside + 消息 log）—— **baseline 即存在**，本轮未引入（已用 `git stash` 对照确认）。

## 已知遗留 / 下一轮待办

1. **`[scrollable-region-focusable]`（pre-existing）** — roster `<aside>` 和消息 `role=log` 容器都有 `overflow-y: auto` 但没有 `tabindex="0"`，键盘用户无法独立聚焦滚动。修复很小（各加 `tabindex={0}` + 适当 `aria-label`/focus 样式），留给 round 1。
2. **移动端 topbar 20px 水平溢出（pre-existing，工作树中 `topbar.tsx` 已被改）** — 来自 sign-out 按钮 + 图标，不是消息列表引起。留给对应 topbar 那轮处理。
3. **气泡圆角/间距/微动效** 还没系统调过，王设计可能有进一步建议（如 own 气泡用稍深 primary、入场上推动画等）。
4. **`max-w-[44ch]` 的阈值** 是经验值，长英文段落 + CJK 混排时可再观察是否需要 token 化。

## commit

`feat(ux): ux-patrol round 0 - 消息列表可读性 P0`（本地，未 push）
