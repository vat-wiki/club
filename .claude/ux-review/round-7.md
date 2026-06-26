# ux-patrol round 7 — 错误反馈边界评审 + 饱和确认

**日期**: 2026-06-26
**范围**: `packages/web`（错误反馈/边界 + 首次体验视角；**无新代码**）
**上轮**: round 6（commit `e6859e4`，composer 收尾 + SSE 审查 + 趋饱和评估）

## 视角

按 round 6 建议，这轮挖**错误反馈边界 + 首次体验**（前几轮没深挖的维度），确认是否还有可改 P0。

## 评审结论：错误反馈质量高，基本无缺口

读 `auth-dialog.tsx`（错误反馈核心，首次深入）：

- **paste 无效 key**：`api.me` 预验证 → 友好文案「that key wasn't recognized」+ 清空 pasteKey + `requestAnimationFrame(focus)` 回输入框；`role=alert` + `aria-invalid` + `aria-describedby`。a11y 到位。
- **create**：空 name →「pick a callsign first」；`maxLength=40`；busy 态「joining…」；按钮 disabled。
- **dialog 不可 Esc/点外关闭**（未认证前）——避免用户误关卡死。
- 发送失败（composer error 态 + draft 恢复，round 5 确认）、空消息（`!value.trim()` disabled）、连接断（banner + status dot）——都已覆盖。

## 小 P2（记录，未改）

- **create 与 paste 的错误文案不一致**：create catch 用原始 `(e as Error).message`，paste 用友好固定文案。但 club API 返回的 message 是否已友好未确认（改了可能反 worse），记录观察，不改。
- **超长消息无前端长度限制**：textarea autosize 封顶 200px（视觉 OK），但 `api.send` 无前端 maxLength。属产品决策（消息长度策略），交王产品。

## composer.tsx 又 M（外部活跃）

`composer.tsx` 在 round 6 commit（2c7d001）后**又被外部改了**（M 状态）——外部仍在活跃迭代 composer。ux-patrol 继续避开该文件。

## packages/web 体验面确认饱和

累计 7 轮 + 外部 DESIGN_REVIEW（P0/P1 全落地）+ composer 重构，已系统覆盖：视觉/动效、可读性、a11y、移动端、加载、SSE 体验面、错误反馈边界。**连续 round 6/7 两轮无新可改 P0**（靠评估维持），确认 packages/web 体验/视觉/交互的高价值改进空间已耗尽。

继续每 30 分钟在 packages/web 发散评审，产出以「健康复验 + 偶尔小 P2」为主，边际价值很低；且外部仍在活跃改 packages/web，ux-patrol 在此域有撞车风险。

## 建议（给主对话，强）

建议 ux-patrol 换轨道（择一）：
1. **转其他包的体验/可用性**：cli（输出/错误/交互）、server（API 错误响应/文档）、mcp（工具描述/错误）。需调整为非浏览器评审方式。
2. **暂停** ux-patrol；功能增量（optimistic send、SSE 断线补拉、消息长度策略）交给对应角色（王产品/王后端）。
3. 维持 packages/web 30min，但接受产出以健康复验为主（低边际）。

## 遗留待办

- create/paste 错误文案一致性（P2，待确认 API message 质量）。
- 超长消息策略（交王产品）；SSE 断线补拉（交王后端）；optimistic send（交王前端/王产品）。
- safe-area-inset（需真机）；round 3 preference（own/others 明度交王产品等）。

## commit

`docs(ux): ux-patrol round 7 - error-feedback audit + saturation confirmed`（本地，**未 push**；仅 round-7.md，无代码改动）
