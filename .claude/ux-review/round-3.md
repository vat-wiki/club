# ux-patrol round 3 — 视觉/动效专项

**日期**: 2026-06-26
**范围**: `packages/web`（视觉/动效视角）
**上轮**: round 2（commit `bf38e7f`，移动端 topbar 溢出 + 触控）
**评审**: 王设计首次出场，DOM 实测取证（`getComputedStyle`/`getBoundingClientRect`，比截图目测精确）

## 复验 round 2 — 无视觉回归

王设计实测确认：移动端 topbar 不再横向溢出（header right=390=viewport）、触控区达标、a11y focus ring 克制不突兀、隐藏 status 文字后移动端 topbar 平衡尚可。

## 王设计评审总评

整体视觉语言**高度自洽、有作者性**（graphite 三层灰阶 + mint/amber 双色 + IBM Plex/Space Grotesk + out-quint 吸附曲线），不是 shadcn 裸味。**最弱环节是动效的状态切换与瞬时确认**。报告把建议明确分成「客观该修」和「主观 preference」两类。

## 本轮实现（客观该修，三条小改）

### P0-1 · composer focus 渐变线硬切 → opacity 渐显（已实现+验证，**未纳入本 commit**）

- **问题**（客观动效 bug）：composer `<form>::after` 那条聚焦薄荷绿线，class 写 `after:transition-colors`，但实际改的是 `background-image`（`via-agent/0`→`/60`），而 `transition-colors` **不含 `background-image`**——实测 `::after.transition` 只有 color/bg-color/border-color，所以聚焦那一下是**硬切**，违背全库 out-quint 基调。
- **修法 A**：`::after` 固定 `via-agent/60`，未聚焦 `opacity-0`、`focus-within:opacity-100`，配 `after:transition-opacity after:duration-slow`（自动 out-quint）。
- **验证**：`afterTransition = "opacity 0.32s cubic-bezier(0.16,1,0.3,1)"`、`transitionHasOpacity=true`、focus 时 opacity 0→1。
- ⚠️ **未 commit**：`composer.tsx` 本轮检测到**外部并行重构**（autosize cap 160→200、textarea+button 包成 raised input-bar 容器、textarea 透明化，注释引用另一套"P0-1/P0-4/P0-5"评审体系）——系统标记为用户/linter intentional 改动。我的 P0-1 与之**协同**（该重构注释明确依赖 `form::after` 做 focus 反馈），但为不抢 commit 别人的并行工作，**composer.tsx 不纳入本 commit**，P0-1 留在工作树随该文件落盘时一并带走。

### P1-1 · status dot/label 状态切换加过渡（已 commit）

`topbar.tsx` status dot（`bg-agent`/`bg-human`/`bg-destructive`）原本 `transition: all` 无 duration = 硬切。加 `transition-colors duration-slow`（实测生效：`color/background-color/... 0.32s cubic-bezier(0.16,1,0.3,1)`）。label 颜色固定不变，无需过渡。

### P2-4 · day-divider tracking 统一（已 commit）

`message-list.tsx` DayRule `tracking-[0.12em]` → `[0.14em]`，与 roster section header 统一。

## 主观 preference（未实现，留产品/用户拍板）

王设计标注为 preference，不在本轮自动改：

- **P1-2** self-mention 行级 wash `bg-primary/5` 太弱（实测 5% 肉眼几乎不可见，全靠 border-l 扛）→ 建议提到 `/10`。preference。
- **P1-3** own 气泡（mint/15）比 others（card 实色）亮一档，长对话里自己发言视觉权重偏高，弱化「人机平等」灵魂。建议 (a) own 降到 /10 或 (b) others 气泡也带 kind 色（agent/human-soft）——**涉及产品灵魂，建议交「王产品」拍板**。
- **P1-4** send 按钮 hover 只有变色无手感 → 加 `active:scale-[0.97] transition-transform duration-fast`（**不加 hover scale**，会显廉价）。preference 但参数明确、风险极低，下轮可顺手做。
- **P2-1** 自己刚发送的消息缺瞬时确认 → `bubble-ack` 高亮脉冲（依赖 optimistic send，属功能增量）。
- **P2-2** 新 @我 消息到达缺注意力强调 → border 呼吸（依赖未读状态）。
- **P2-3** hover 高亮铺满整行（Slack 式）vs 收敛到气泡（Linear 式）。preference。
- **质感** others 气泡可加 `--shadow-pop` 抬起感，own 保持平。preference，低优先。

## 验证

- `npm -w @club/web run typecheck` — 通过。
- `npm -w @club/web run test` — **50 passed / 4 files**。
- playwright DOM 实测（P0-1 + P1-1）：见上。

## 遗留待办

1. **P0-1 待 commit**：composer.tsx 外部并行重构落盘后，确认 P0-1 随之进入 git（或下轮若 composer 仍悬，单独 commit P0-1 那一行）。
2. P1-3 own/others 气泡明度对等 → 交「王产品」（产品灵魂维度）。
3. P1-2 / P1-4 / P2-1 / P2-2 / P2-3 / 质感 — preference，按拍板实现。
4. 继承：P1-2 safe-area-inset（需真机）、round 1/2 的 P2（composer `aria-haspopup`、mention 空状态 `role`、`max-w-[44ch]` 观察、composer hint 10px）。

## commit

`fix(web): ux-patrol round 3 - 视觉/动效客观修复 (status dot / day-rule)`（本地，**未 push**；不含 composer.tsx）
