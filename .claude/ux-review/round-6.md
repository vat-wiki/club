# ux-patrol round 6 — composer 收尾确认 + SSE 可靠性 + 饱和评估

**日期**: 2026-06-26
**范围**: `packages/web`（复验 + 可靠性审查 + 评估，**无新代码**）
**上轮**: round 5（commit `193cebf`，boot loading state）

## composer 收尾 ✅（自然解决）

外部作者在 round 5 之后 commit 了 `2c7d001 feat(web): 强化 composer 输入框存在感`——把 input-bar 重构（per `composer-presence-review.md` P0-1/2/4/5）+ 我的 round 3 P0-1（focus 线 opacity）**一起落盘**。`packages/web` 工作树已全干净，P0-1 进 git。

**无需 ux-patrol 接手**（上轮声明的默认接手没触发，外部自己 commit 了）。悬了 3 轮的 composer P0-1 收尾。

## 复验（无回归）

playwright 实测：composer input-bar 边框 `1px rgb(63,63,70)`（L26%，P0-2）、容器 `bg-card`（raised，P0-1）、textarea 透明继承、`min-h-[48px] sm:min-h-[56px] max-h-[200px]`（P0-5）；desktop axe **0**；移动端 390 溢出 **0**。composer 重构 + round 5 boot loading 都健康。

## useMessageStream 可靠性审查（round 5 遗留）

读 `hooks/use-message-stream.ts`：SSE 体验面**完整**——有重连（onError → `lost` + 3s setTimeout reconnect）、status 三态反馈（connecting/connected/lost）、消息按 id 去重。

**唯一缺口（功能增量，交王后端）**：重连后**不补拉断线期间的消息**——断线 10s 期间别人发的消息，重连后不会出现（SSE 只推订阅后的，无 `since` 补拉）。可靠性问题，非体验面；需后端 messages API 支持 `?since=` + 重连后补拉，交王后端评估。

（次要：固定 3s 退避非指数；`connected` 在 stream 返回后立即设而非 onOpen——影响都小，不计。）

## packages/web 体验面饱和评估

6 轮 ux-patrol + 外部 DESIGN_REVIEW（P0/P1 全落地）+ composer 重构，已系统覆盖：
- 视觉/动效（DESIGN_REVIEW：灰阶 token、dialog 阴影、out-quint、hover、agent-pulse、slide-in、brand-pulse、status dot 过渡、day-rule tracking、composer focus 线）
- 可读性（round 0：气泡对齐、self-mention 换色 + 行级 wash）
- a11y（round 1：scrollable-region tabindex）
- 移动端（round 2：topbar 溢出、触控 44px、移动端 status 收敛）
- 加载（round 5：boot loading 不闪空状态）
- SSE 体验面（重连 + status 反馈）

**结论**：packages/web 的体验/视觉/交互高价值改进空间已基本耗尽。继续每 30 分钟发散评审的边际产出很低（近两轮 round 4/6 都无新可改 P0，靠评估维持）。

## 建议（给主对话）

ux-patrol 后续更划算的方向（择一）：
1. **转向其他包的体验/可用性**：cli（命令行输出/错误提示/交互）、server（API 错误响应/文档）、mcp（工具描述/错误）。需调整评审方式（非浏览器）。
2. **暂停** ux-patrol，把精力让给功能增量（optimistic send、SSE 断线补拉）——这些是王产品/王后端的活，不是 ux-patrol 视觉/交互巡检能做的。
3. 维持 packages/web 30min，但接受产出以"健康复验 + 小修"为主。

## 遗留待办

- SSE 断线消息补拉（功能增量，交王后端）。
- optimistic send（功能增量，交王产品/王前端）。
- P1-2 safe-area-inset（需真机）、各轮小 P2（mention 空状态 role、aria-haspopup、max-w-44ch、composer hint 10px、round 3 preference 如 own/others 明度交王产品）。

## commit

`docs(ux): ux-patrol round 6 - composer 收尾 + SSE 审查 + 饱和评估`（本地，**未 push**；仅 round-6.md，无代码改动）
