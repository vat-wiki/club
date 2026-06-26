# ux-patrol round 2 — 移动端 topbar 溢出 + 触控目标

**日期**: 2026-06-26
**范围**: `packages/web`（移动端视角）
**上轮**: round 1（commit `9967b9b`，scrollable-region a11y）
**评审**: 王体验移动端报告（截图 `.claude/ux-review/r2-*.png`）

## 复验 round 1 — 通过，无回归

移动端 axe WCAG 2.1 A/AA **0 违规**；`[role=log]` 与 `<aside>` 的 `tabIndex={0}` 渲染正确；focus ring（薄荷绿 1px inset）移动端键盘焦点下清晰；桌面端回归也 0 违规。

## 本轮评审 + 实现

### P0：移动端 topbar 横向溢出（pre-existing，round 0/1 继承）— 已修

王体验实测根因双层：① sign-out button 内容（"sign out" 文本 52px + LogOut svg）溢出 44px button、因 `overflow:visible` 画到视口外；② header items 总宽 316px > 可用 298px。实测 390px 溢出 20px、360px 溢出 50px，页面可横向滑动、topbar 错位露白。

按王体验实测验证过的 Plan A（deOverflow=0）实现（`topbar.tsx`）：
- **status 文字**（`connected/connecting/lost`）→ `<span className="sr-only sm:not-sr-only">`：移动端视觉隐藏（1px clip），桌面端显示；SR 仍可读（`role=status` + `aria-live`）。释放 ~70px。颜色 + Radio icon + dot 已是非唯一信号（WCAG 1.4.1）。
- **sign-out 的 "sign out" 文本** → `hidden ... sm:inline`：移动端隐藏，桌面显示。button 已有 `aria-label="sign out (test_1)"`，无障碍名称完整，隐藏视觉文本不影响 a11y。
- **name span** → `max-w-[6ch] ... sm:max-w-[10ch]`：移动端收窄，配合上述两处释放的空间，name 不再被压成 0 宽。

### P1-1：composer 触控目标 42→44px（WCAG 2.5.8 / 2.5.5）— 已修

`composer.tsx`：Textarea `min-h-[42px]→[44px]`、send Button `h-[42px]→[44px]`（与 topbar 的 `.tap-target` 44×44 标准对齐，两处同步改保持底对齐）。

### P1-3：sign-out name 被截断成 0 宽 — 已修（P0 副产品）

隐藏 "sign out" 文本 + name 收窄后，移动端 name 恢复可见（实测 390px 完整 42px 显示 `test_1`）。

## 验证（headless chromium，登录 test_1，三视口）

| 视口 | 溢出(px) | sign-out right | name 宽 | name 文本 | textarea/send 高 | status 文字 | axe |
|---|---|---|---|---|---|---|---|
| 390×844（原 20）| **0** | 374 | 42px | test_1 完整 | 44/44 | sr-only(1px) | 0 |
| 360×640（原 50）| **0** | 344 | 22px | 截断非0 | 44/44 | sr-only | 0 |
| 1280×800 桌面 | 0 | 1264 | 42px | test_1 | 44/44 | 显示 68px | 0 |

- `npm -w @club/web run typecheck` — 通过。
- `npm -w @club/web run test` — **50 passed / 4 files**。
- 桌面端零回归：status 文字、sign-out 文本、name max-w-[10ch] 全部 ≥ `sm` 断点恢复显示。

## 遗留待办（继承 + 本轮）

1. **P1-2 safe-area-inset（刘海 / home indicator）** — 全项目 0 处理，`index.html` 已设 `viewport-fit=cover` 但无配套 padding。**留下轮**：playwright 模拟不了 `env(safe-area-inset)`，效果只能真机验证，不盲目改。落点已备：topbar `pt-[max(0.625rem,env(safe-area-inset-top))]`、composer `pb-[max(0.75rem,env(safe-area-inset-bottom))]`。
2. **P2 composer hint 文字 10px 偏小**（移动端 7.5pt）— 建议 `text-[11px] sm:text-[10px]` 或全局最小字号 token。
3. **P2 气泡圆角/微动效** — 建议交「王设计」系统评估。
4. **P2 composer `aria-haspopup="listbox"`、mention 空状态 `role`**（round 1 继承）。
5. **`max-w-[44ch]` 阈值观察**（round 0 继承）。

## commit

`fix(web): ux-patrol round 2 - 移动端 topbar 横向溢出 + 触控目标`（本地，**未 push**）
