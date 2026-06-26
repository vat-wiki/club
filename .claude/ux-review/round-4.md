# ux-patrol round 4 — 综合健康复验 + 环境评估

**日期**: 2026-06-26
**范围**: `packages/web`（健康复验 + 状态评估，**非新视角发散**）
**上轮**: round 3（commit `7a49166`，status dot 过渡 + day-rule tracking；P0-1 composer focus 线已实现但未 commit）

## 为什么这轮不发散新评审

读了工作树里两份**外部并行评审**，发现 packages/web 已被系统优化过一轮，避免重复：

- **`DESIGN_REVIEW.md`（王设计整体评审）** — P0/P1 几乎**全部已落地**：
  - P0-1 三层灰阶 token（`--background 7%` / `--chrome 10%` / `--card 12%` / `--border 20%`）✓
  - P0-2 dialog 阴影（`shadow-[var(--shadow-pop)]` + `ring-1 ring-white/[0.06]` + `--shadow-pop` token）✓
  - P0-3 全站 transition（config `transitionTimingFunction DEFAULT=out-quint`、`duration fast/slow`）✓
  - P0-4 hover（`--accent` 提亮到 24%，三处 `hover:bg-accent/70`）✓
  - P1-2/P1-7/P2-2（agent-pulse scale、slide-in 6px、brand-pulse）✓
- **`composer-presence-review.md`（王设计针对「输入框存在感弱」的专项评审）** — 其 P0-1~P0-5 方案**正在被实现**（就是 composer.tsx 那套未 commit 的外部重构：raised input-bar 容器、bg-card、抬高到 56px、autosize max-h-200；注释里的「P0-1/P0-4/P0-5」对得上）。

ux-patrol round 0-3 做的（消息可读性、a11y、移动端溢出、status dot/day-rule/focus 线动效）是这些评审**没覆盖**的细节，独立价值成立。但继续每 10 分钟硬找新 P0 的边际价值已递减，且多方并行改 packages/web（composer 撞车已发生）有冲突风险。

## 综合健康复验（确保多方并行改动无回归）

playwright 实测（headless，登录 test_1）：

| 检查项 | 结果 |
|---|---|
| dialog `--shadow-pop` + ring 生效（P0-2） | ✅ |
| round 0 own 消息右对齐（flex-row-reverse） | ✅ |
| round 0 self-mention 行级 wash（bg-primary/5） | ✅ |
| round 3 status dot color 过渡 | ✅ |
| round 3 composer focus 线 opacity 过渡（P0-1，未 commit） | ✅ 仍在 |
| 桌面 axe WCAG 2.1 A/AA | **0 违规** |
| 移动端 390 横向溢出 | **0** |

**结论**：所有改动健康，无回归。

## composer.tsx 状态（需主对话/用户决策）

`composer.tsx` 仍 **M 未 commit**，含两套改动：
1. 外部并行重构（input-bar 容器化、bg-card、56px、autosize 200）— 对应 `composer-presence-review.md` 方案。
2. 我的 round 3 P0-1（form `::after` focus 线 opacity 控制）— 已验证生效，与外部重构**协同**（外部注释依赖 form::after 做 focus 反馈）。

外部重构者写了 review 但 composer.tsx diff 近两轮未再变（可能停滞）。ux-patrol 一直让出该文件不抢 commit。**建议主对话确认这套 composer 重构的归属**：若用户/其 agent 在做，待其落盘时 P0-1 随之进 git；若是孤儿改动，可让 ux-patrol 整体 commit（含 P0-1）。

## 本轮无新代码改动

环境已饱和（DESIGN_REVIEW P0/P1 全落地、composer 重构进行中），无明确的、未被覆盖的 P0 可做。不强制造改动，避免和外部冲突 + 避免重复。

## 建议（给主对话）

ux-patrol 已跑 4 轮 + 外部 DESIGN_REVIEW + composer 重构，packages/web 体验/视觉已系统优化。建议决策 ux-patrol 后续策略：① 暂停让外部 composer 重构收尾；② 降频（如 30min）；③ 转向其他包（cli/server/mcp）；④ 继续 packages/web。

## 遗留待办（继承）

- composer P0-1 待落盘（见上）。
- P1-2 safe-area-inset（需真机验证，playwright 模拟不了 env()）。
- 各轮 P2：composer `aria-haspopup`（composer 被占）、mention 空状态 `role`、`max-w-[44ch]` 观察、composer hint 10px。
- round 3 preference：P1-2 wash 强度、P1-3 own/others 明度（产品灵魂，交王产品）、P1-4 send 按压、P2-x 标志性动效。

## commit

`docs(ux): ux-patrol round 4 - 健康复验 + 环境评估`（本地，**未 push**；仅 round-4.md，无代码改动）
