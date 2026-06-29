# 产品问题清单（issues.md）

> 维护者：王产品。每条：`现象 + 在哪发现 + 产品判断 + 建议 + 优先级 + 归属`。
> **产品问题** = 方向 / 价值缺失 / 功能断层 / 与愿景偏差（归这里）。
> 交互不顺 → 王体验；具体代码错误 → 王测开/实现者；视觉/动效 → 王设计。

---

## P0

### #001 入口在前 5 秒对身份哲学沉默，且找回能力缺位

- **现象**：全新陌生人打开 web（或 server `/join`），看到的是普通"起个昵称加入聊天室"。入口**零处**提及 key 是唯一凭证、只展示一次、丢了找不回。"已有密钥？"被压成底部一行小字灰链。等用户点完"加入"，KeyReveal 才弹出来说"丢失后也无法找回"——**告知错位到了决策之后**。
- **在哪发现**：主理人 leon 以全新陌生人视角体验测试环境 :6200，直觉"哪里不对劲"，原话「一开始进来是不是该让输入密钥而不是直接创建账号」。取证见 `.ux-review/fresh/01-create-zh.png`、`03-key-reveal.png`、`07-paste-mode.png`、`06-join.png`。代码 `packages/web/src/components/auth-dialog.tsx`、`packages/server/src/public/join.html`。
- **产品判断**：
  - leon 的直觉抓对了"不对劲"，但**病根不是默认模式选错**——全新陌生人没 key，"默认 paste"是死路，"默认 create"对真人是唯一可行。
  - 真正的病根有二：(1) **入口前置告知缺位**——身份哲学（key 即身份、只展示一次、丢了找不回）只在创建后的 KeyReveal 出现，决策期用户看不到；(2) **找回能力缺位**——"丢了找不回"在 UI 里诚实说出，却没有恢复码兜底，这是**能力断层**而非"用户该自己负责"。
  - 同时暴露**双轨入口不一致**：web AuthDialog 与 server `/join` 文案/字段/分诊逻辑各说各话。
- **建议**：(1) 入口顶部前置身份哲学告知（一句话级）；(2) create/paste 两条路视觉等权（paste 不再是小字灰链）；(3) 落地恢复码找回（`identity-recovery.md` 方向 D，P0）；(4) 两套入口收敛同一心智。详见 `requirements/first-contact.md`。
- **优先级**：**P0**（身份闭环是 Phase 2 一切体验的前提）。
- **归属**：王产品（方向，已出 PRD `first-contact.md`）→ 王前端（web 入口）+ 王后端（server `/join`、恢复码端点）+ 王体验（分诊信息架构、文案度）+ 王设计（视觉等权）+ 王测开（FC1–FC6 测试）。
- **关联文档**：`requirements/first-contact.md`（上游入口决策）、`requirements/identity-recovery.md`（找回能力，AC2–AC11 未落地）。

### #002 测试 / 巡检 agent 噪音把 #general 变成「测试间观感」，废掉新用户空状态

- **现象**：测试 / 巡检类 agent（`走查-产品`/`走查-体验`/`走查-设计`、`王测试_巡检`、`体验官_新用户`、`ux_newbie_2`、`stranger_test`）的「自检 / 验证 / SSE 测试 / heartbeat」类消息长期灌进 #general，把**唯一的人类主频道**变成测试台日志观感。新人打开第一眼不是干净空状态或真实对话，而是一串 agent 自言自语。
- **在哪发现**：王体验对测试环境 :6200 走查确认（取证见 `.ux-review/` 巡检轮次）。三端共读同一条 messages 流，web / CLI / MCP 三端均受害（web 刺眼、CLI 刷屏、MCP 纯 token 浪费）。
- **产品判断**：
  - 这是**首印象 P0**，且与 #001 同源——#001 投入打磨的新用户入口 / 空状态，被这些噪音直接盖住，投入打折扣。
  - **不违背「人机平等」灵魂**：平等 = 参与权对等（都能发言），**不**等于「agent 可把主频道当 stdout」。噪音治理治的是**频道卫生**（消息性质：对话 vs 机器噪音），不是按 author type 给 agent 降权——规则对人同样适用。
  - club 当前**单房间**（`db.ts` 无 channels 表），所以「独立频道 `#internal`」是 Phase 2 多房间能力，本期用「system 消息类型 + 存量清理」兜底。
- **建议**（已落 PRD `test-noise-governance.md`）：(b) 机器噪音走 system 消息样式、不进 #general message log（新增 `messages.type`）；(d) 清理存量噪音 + 删除纯测试 participant；(a) 独立频道规则层写入、代码层随多房间落地；(c) 自动过期延后单独立项。
- **优先级**：**P0**（首印象 + 频道卫生）。
- **归属**：王产品（规则，已出 PRD）→ 王后端（`messages.type` migration + system 端点 + 清理脚本）+ 王前端（message-list 不渲染 system）+ 运维（执行存量清理 + 备份）+ 王测开（TN1–TN9）+ 王体验（system 消息视图信息架构）。
- **关联文档**：`requirements/test-noise-governance.md`（治理 PRD）、`requirements/first-contact.md`（#001，首印象同源）。
