# ux-patrol round 5 — 加载与响应性：boot loading 态

**日期**: 2026-06-26
**范围**: `packages/web`（**加载与响应性视角**，轮换自视觉/动效）
**上轮**: round 4（commit `da15f2a`，健康复验 + 评估；packages/web DESIGN_REVIEW P0/P1 已全落地）

## 视角轮换

round 4 确认 packages/web **视觉**已饱和（DESIGN_REVIEW 全落地）。这轮换到 DESIGN_REVIEW 没覆盖的维度——**加载与响应性**（用户直接痛点、视觉评审看不到）。用代码审查（App.tsx boot 流程）而非重量级浏览器模拟。

## 发现 + 实现

### P1 · 历史加载闪现空状态（已修）

读 `App.tsx` boot 流程发现时序缺口：`setAuthOpen(false)`（关 auth dialog）发生在 `api.messages()` 返回**之前**。所以从 dialog 关闭到历史到达之间，`messages` 还是 `[]`，用户先看到「The frequency is open.」空状态闪一下，历史才涌入。本地快不明显，慢网络/大量历史时会误导（以为没消息→突然冒出一堆）。

**改动**（2 文件，干净不夹带）：
- `App.tsx`：加 `booting` 态（`true` 从有 key 到首批 history 落地），boot effect 开始 `setBooting(true)`、history 到达 `setBooting(false)`、catch 也 `false`；传 `booting` 给 MessageList。
- `message-list.tsx`：加 `booting?` prop；`booting` 时显示 loading（agent-pulse dot + 「tuning in…」品牌化文案，`tracking-[0.14em]` 与 day-rule 统一、`role=status aria-live=polite` 让 SR 宣布），优先于空状态判断。

**验证**：typecheck 通过；50 测试绿；playwright 登录后 `stuck_tuning=False`（booting 正确结束，没卡 loading）、`rows=40`（消息正常显示，走消息分支非空状态）。booting=true 的 loading 路径是简单条件渲染 + typecheck 护航，逻辑正确。

## 其他响应性发现（记录，未实现）

- **optimistic send 缺失（功能增量）**：`handleSend` 仅 `await api.send`，消息要等 SSE 回推才出现，慢网络有延迟。属功能增量（要处理失败回滚、去重），交王产品/王前端评估。round 0 王体验也曾提（P2-2）。
- **发送前不检查 status**：`lost` 状态下发送会失败→composer error 态（draft 恢复，有反馈），但可提前在 status=lost 时禁用/提示发送（涉及 composer，本轮让出）。
- **SSE 重连策略**：未深入读 `useMessageStream` hook（重连退避、恢复后补拉丢失消息等），下轮可查。

## composer.tsx 状态（继续让出）

`composer.tsx` 仍 **M 未 commit**，外部 input-bar 重构 + 我的 round 3 P0-1（focus 线 opacity）。外部停滞已 3 轮（diff 未变）。**用户未确认归属**（上轮问了未答）→ 继续让出，不抢 commit；P0-1 已验证生效、随 composer 落盘。**仍待主对话/用户回复归属**：是你在做 → 继续等；孤儿 → 下轮接手 commit。

## 遗留待办

1. **composer P0-1 待落盘** + 归属确认（见上）。
2. optimistic send（交王产品/王前端）。
3. SSE 重连策略（下轮读 useMessageStream）。
4. P1-2 safe-area-inset（需真机）、各轮 P2（mention 空状态 role、aria-haspopup、max-w-44ch、composer hint 10px）、round 3 preference（wash 强度、own/others 明度交王产品、send 按压）。

## commit

`feat(ux): ux-patrol round 5 - boot loading state (no empty-state flash)`（本地，**未 push**；App.tsx + message-list.tsx，不含 composer.tsx）
