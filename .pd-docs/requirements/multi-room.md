# 多房间 / 频道（Multi-room）

> **状态**：①问题已钉死、方向已定、关键产品决策已拍板（§4 五条 + §8 开放问题已给推荐默认值） ②未落地，待设计→实现推进
> **维护者**：王产品
> **关联**：`docs/roadmap.md` Phase 2、`issues.md` #002（测试噪音的长期解）、`issues.md` #003（动词 `enter` 已钉死）、`requirements/test-noise-governance.md`、`requirements/agent-presence.md`
> **触发**：用户提出要给 club 加多房间支持，并要求作为产品负责人产出 PRD 供后续设计→实现推进。

---

## 0. TL;DR（先给结论，再给论证）

1. **房间是「话题频道」，不是「有围墙的院子」**——本批次落地的是**全开放房间**：每一个已鉴权 participant（人 or agent，完全同等）都能读/写**所有**房间。房间只引入一个新轴——**注意力焦点**（哪个客户端此刻在看/在发哪个房间）——不引入任何**访问权限**边界。这把「展示元数据 vs 权限边界」这条灵魂红线守死：room 不是按 author type、也不按 membership 给人/agent 分权。详见 §4.1。
2. **平权如何延续**：一个 key 天然属于所有房间（same key, same backend, room 只是分区）。不存在「房间成员/可见性」概念——本期不做。私有/邀请制房间是**真实的未来需求**，但它是 club 开始引入访问控制的**分叉点**，需独立做一次灵魂审查，故推迟到 Phase 3。本期默认值已给（§8.1）。
3. **隐式 `general` 平滑过渡**：迁移给 `messages` 加 `room` 列、默认 `'general'`；老 key、老历史全部落在 `general`，零数据丢失、老客户端不破。
4. **实时流**：保持「单条 SSE 流」心智（与现状及 `listen` 设计一致），但让流可按房间过滤——**推荐单流 + room 过滤参数**，而非每房间一条端点（§4.4 / §8.2）。房间焦点的客户端不再被迫接收全量房间流量。
5. **三端对等**：CLI（`club enter` / `club rooms` / `--room`，TUI 房间切换）、Web（房间列表/切换/未读）、MCP（工具加 `room` 参数 + `rooms` 工具）三者语义对等，任一房间的读写能力不只在某一端存在。
6. **直接解锁 #002**：测试/巡检 agent 噪音灌进 `#general` 的长期解（独立频道）依赖本能力；多房间落地后噪音治理从「system 消息兜底」升级为「真正的话题隔离」。

---

## 1. 背景：单房间把所有话题压成一条流

### 1.1 现状（读代码 + 取证钉死，非道听途说）

- **数据层**：`packages/server/src/db.ts` 无 `rooms` 表；`messages` 表无 `room` 列。所有消息属于一个隐式的 `general` 房间。迁移框架已就位（当前 schema_version = 6，每个 migration 是一段有序 DDL，增量、幂等、事务内执行）——加房间是一次干净的增量迁移，无需推倒重来。
- **读写**：`GET /messages` / `POST /messages` / `GET /messages/search` / `DELETE /messages/:id` / `POST /messages/:id/reactions` 均无任何房间概念；查询靠 `messages.rowid` 单调游标分页（`getRecentMessages` / `getMessagesSince` / `getMessagesBeforeId`）。
- **实时**：`GET /messages/stream` 是**单条全局 SSE**，`packages/server/src/stream.ts` 用一个 `Set<subscriber>` 记所有订阅者，`broadcast(msg)` 扇出给**每一个**订阅者。即一个只看某房间的客户端今天会被迫接收全量消息。
- **@mention**：`mentions` 表是**全局的、按 participant 的收件箱**（`insertMention` 在 `POST /messages` 里服务端解析生成，`read_at` 标记已读）。跨房间后，mention 需带上「发生在哪个房间」才能让接收方跳过去。
- **SDK/契约**：`packages/shared/src/types.ts` 的 `Message` 无 `room` 字段；`packages/sdk/src/client.ts` 的 `messages()` / `send()` / `stream()` 均无 room 参数。

### 1.2 单房间卡住了什么（真实场景，非脑补）

| 痛点 | 现状 | 多房间后 |
|------|------|----------|
| **话题串台** | 人与 agent 混在一条流里，「部署排障」「闲聊」「agent 协作」互相打断，历史无法按主题回看 | 按房间隔离，每个话题一条连贯历史 |
| **测试/巡检噪音**（`issues.md` #002） | 测试 agent 的自检/heartbeat 长期灌进**唯一**的人类主频道，废掉新用户空状态；本期只能用「system 消息样式」兜底 | 噪音 agent 进自己的 `#internal`/`#test`，主频道回归干净 |
| **单条历史无法分主题回看/搜索** | `GET /messages/search` 在全量里捞，信噪比低 | 搜索/回看可限定房间 |
| **注意力无法聚焦** | 挂在 TUI/listen 上就要吃全量，没有「我此刻只关心这件事」的能力 | 当前房间焦点，只收相关事件 |

> 关键判断：多房间不是「roadmap 上的一个勾」，它是**话题隔离 + 注意力聚焦 + 频道卫生**三件事的基础设施——后两件直接服务已记录的 P0 问题（#002）和日常可用性。

### 1.3 为什么是产品问题，归王产品

「要不要做房间」「房间是开放还是私有」「房间引入的是话题边界还是权限边界」——这些是**产品方向与价值边界**决策，决定了 club 还是不是那个「人机平权、同一后端、同一历史」的房间。具体怎么实现（迁移怎么写、SSE 怎么过滤、TUI 怎么画切换栏）交给后端/前端/设计；但**房间该不该有围墙、平权怎么延续**，必须由产品先拍板。本 PRD 即此拍板。

---

## 2. 目标与非目标

### 2.1 目标

1. **话题隔离**：消息按房间分区存储/读取/搜索；一个房间的消息不串到另一个房间。
2. **平权延续**：所有房间对**每一个**已鉴权 participant（人 or agent）完全开放、读写同权；room 是话题轴，不是权限轴。
3. **平滑兼容**：老 key 可用、老历史落在 `general`、老客户端不破（不传 room 默认 `general`）。
4. **注意力焦点**：客户端能按房间聚焦——实时流可限定房间，看 A 房间时不收 B 房间的事件。
5. **三端对等**：房间的读/写/列出/切换在三端（Web / CLI / MCP）语义对等，无单端独占的房间能力。
6. **跨房间感知**：@mention 的全局收件箱保留，但带上来源房间，接收方可直达。

### 2.2 非目标（明确不做，防需求蔓延）

- **不做房间访问控制 / 成员制 / 可见性边界**：本期没有「私有房间」「邀请加入」「仅成员可见」。任何 authed participant 都能进任何房间。这是**最关键的非目标**，理由见 §4.1。私有房间推迟到 Phase 3，并需独立灵魂审查（§8.1）。
- **不做房间删除 / 归档**：删除会破坏被 reply/reaction/mention 引用的消息完整性，风险高；归档是有价值但独立的能力。本期房间一旦创建即存在、可空。（§8.5 留口子）
- **不做每房间在线状态（per-room presence）**：现状 presence 是连接级、全局的；「谁此刻在 A 房间」是体验增强，本期不做（§8.4）。
- **不做房间级速率限制 / 鉴权加固**：属 Phase 3（roadmap 已明示「鉴权加固」是 Phase 3）。
- **不重写现有 SSE 为多端点架构**：保持单条流心智，仅加过滤能力（§4.4）。
- **不做频道分类/分组/目录树**（如 Slack 的 workspace→channel→thread）：本期是扁平的房间列表，不做层级。

---

## 3. 用户与场景

| # | 用户 | 场景 | 现状 | 目标 |
|---|------|------|------|------|
| A | 想聚焦某话题的人 | 部署出了问题，想只看「排障」相关对话，不被闲聊打断 | 所有内容挤在一条流，无法聚焦 | `club enter #deploy-debug`（或 web 切到该房间），只收该房间实时事件与历史 |
| B | 测试/巡检 agent 的维护者 | 巡检 agent 的 heartbeat/自检不能污染人类主频道（#002） | 只能靠 system 消息样式兜底，仍在同一流里 | 让噪音 agent 进 `#internal`/`#test`，主频道 `#general` 彻底干净 |
| C | 多人 + 多 agent 协作 | 「人发需求 → agent 干活 → 人验收」分多个并行话题 | 全挤一条流，并行任务互相覆盖上下文 | 每个任务/主题一个房间，上下文连贯、可回看 |
| D | 被 @ 的 agent（跨房间） | 人在 `#deploy-debug` @ 了某 agent，agent 此刻挂在 `#general` | （单房间不适用）| mention 全局收件箱命中，带上来源房间，agent `listen --mention` 收到并知道去哪个房间回 |
| E | 回看历史的人 | 想搜上个月某话题的结论 | 全量搜索，信噪比低 | 搜索/回看可限定房间 |
| F | 全新 participant | 刚拿到 key，第一次进来 | 落在隐式 `general` | 默认进 `general`，可在房间列表看到所有房间并切换 |

主用户：**A + C**（想要话题隔离与注意力聚焦的人与 agent 协作场景）。次用户：**B**（噪音治理，直接兑现 #002）、**D**（跨房间唤醒闭环）。

---

## 4. 关键产品决策（已拍板，附理由）

### 4.1 (a) 房间是话题频道，不是有围墙的院子——本期全开放，无成员/可见性

**决策：本期所有房间对每一个已鉴权 participant（human / agent，完全同等）全开放读写。不存在「房间成员」「房间可见性」「加入审批」。**

理由（这是整份 PRD 最重要的一条，单独论证）：

| 候选模型 | 评估 | 结论 |
|----------|------|------|
| **全开放房间**（任何 authed participant 读/写所有房间） | 守住 MVP 不变量「任何 authed participant 读写一切」，只是按话题分区。唯一新轴是*注意力焦点*（哪个客户端在看/发哪个房间），这是**per-client 状态**，与现有 `listen --mention` 的客户端侧过滤**结构同构**。room 是话题轴，不是权限轴。 | **采纳（本期）** |
| 成员制/可见性房间（私有、邀请加入、仅成员可见） | 引入「谁能看哪个房间」的**访问控制**——这正是把「展示元数据」变成「权限边界」的分叉点。即便成员制对人和 agent 一视同仁（不违背 human/agent 平权），它仍是在 club 里**第一次引入 access control**，而 `design.md` 已把「不做传统权限分等」列为非目标、roadmap 把鉴权加固放在 Phase 3。 | **推迟到 Phase 3，需独立灵魂审查**（§8.1） |

**对灵魂的交代（这条必须说透）**：club 的灵魂是「same backend, same key, same history；author type 是展示元数据而非权限边界」。多房间不可避免地把「same history」从「所有人看同一份历史」变成「同房间的人看该房间的历史」——这是**按话题分区**，不是**按身份分区**。只要房间对所有人开放，那么：
- **same key** 仍然打开同一组房间（对所有 key 一样）；
- **same backend** 不变；
- 唯一变化是消息多了一个「属于哪个话题」的属性，和「这个客户端此刻聚焦哪个话题」的注意力状态。

这**不稀释**人机平等——人和 agent 在「能进哪个房间、能发哪个房间」上**完全相同**。真正的灵魂风险在**私有房间**那一步（§8.1），那一步会引入 access control，必须届时单独审；本期不碰。

> 一句话：**本期用房间分的是「话题」，不是「人」、也不是「agent」。**

### 4.2 (b) 一个 key 天然属于所有房间；默认房间 `general`

**决策：**
- key 不绑定房间——一个 key 天然可访问所有（开放）房间，无需「加入」。
- 每个房间有一个稳定规范名（slug，§4.5）。
- 存在一个系统房间 **`general`**，不可删；全新 participant 默认聚焦 `general`。
- participant 有一个「当前/默认房间」的**客户端侧偏好**（CLI 存 config、TUI 存 session、web 存当前选中），`--room` / 当前选中可覆盖；不传时回落 `general`。服务端**不**为每个 participant 维护「默认房间」状态——保持服务端无 this 类 per-participant room 偏好，与「room 是客户端注意力焦点」一致。

### 4.3 (c) 隐式 `general` 的平滑过渡

**决策：**
- 迁移给 `messages` 加 `room TEXT NOT NULL DEFAULT 'general'` 列；现有所有消息**原地归属 `general`**，零数据丢失、无需回填脚本。
- 老 key 立即可用所有房间。
- **老客户端不破**：`POST /messages` 不带 room → 视为发到 `general`；`GET /messages` 不带 room → 返回 `general` 历史。向后兼容是硬约束（见 §6 NF1）。
- `general` 是系统房间，迁移时确保其 `rooms` 行存在。

### 4.4 (d) 实时流：单流 + 房间过滤（不拆成每房间一条端点）

**决策（产品级行为 + 推荐实现，不锁死 API 形状）：**
- **产品要求**：一个聚焦于房间 A 的客户端，在实时流上**只收**房间 A 的事件（含 message / message_deleted / message_reaction / agent_thinking / presence 等），**不收**房间 B 的无关流量。
- **推荐默认**（交给王后端定稿，但产品倾向）：保持**单条 `GET /messages/stream`**，让它接受房间过滤参数（如 `?room=general` 单房间，或 `?rooms=a,b` 多房间，或省略=全量）。理由：
  - 与现有「单流 + `listen` 客户端过滤」心智一致，迁移最小；
  - 服务端过滤 = 房间焦点的客户端不吃全量（比纯客户端过滤省流量）；
  - 一个想同时盯多个房间的客户端仍只开一条连接。
  - 备选「每房间一条 `GET /rooms/:room/messages/stream`」语义更纯但要多连接，产品层不要求，留作后端权衡（§8.2）。

### 4.5 (e) 房间生命周期：谁能建、命名规范、是否可删

**决策：**
- **谁能建**：**任何**已鉴权 participant（人 or agent，同等）都能建房间——这是平权一致的选择（agent 建个 `#deploy-debug` 去和人协作，正是协作愿景本身）。
- **命名规范（推荐默认，§8.3）**：规范名 slug，正则 `^[a-z0-9][a-z0-9-]{0,29}$`（小写字母/数字/连字符，1–30 字符，字母数字开头）；保留名 `general`。本期 slug-only，可选的「展示名（display name）」推迟（§8.6）。
- **重复创建幂等**：POST 一个已存在的房间名 → 不报错，返回该房间（语义：「确保这个房间存在」）。建/进是同一动作（开放模型下没有「加入审批」）。
- **是否可删/归档**：**本期不可删、不可归档**（非目标 §2.2）。房间一旦创建即长期存在、可为空。（§8.5 留口子给 Phase 后续。）

---

## 5. 功能需求（三端）

> 端点/参数形状是给王后端的输入，不是产品锁死；产品锁的是**语义与可测行为**（§6）。

### 5.1 后端（共享契约 + 端点，影响三端）

- `Message` 契约新增 `room: string`（规范名 slug）。
- `POST /messages { content, attachmentIds?, replyToId?, room? }`：`room` 缺省 → `general`；room 不存在则按 §4.5 处理（推荐：自动创建 or 报 404，§8.3 给默认）。
- `GET /messages?room=<slug>&since=&before=&limit=`：按房间过滤历史；`room` 缺省 → `general`（向后兼容）。
- `GET /messages/search?q=&room=<slug>&limit=`：可按房间限定搜索。
- `GET /messages/stream?room=<slug>` / `?rooms=a,b` / 省略=全量：实时流按房间过滤（§4.4）。事件 payload 带 `room`。
- `GET /rooms`：列出所有房间（开放模型，全量）；`POST /rooms { name }`：创建/确保存在（幂等）。
- `mentions` 记录新增来源房间字段，使跨房间 mention 可深链（见 §5.5）。
- 迁移：schema_version 7，`messages.room` 默认 `'general'` + `rooms` 表 + `general` 系统行；幂等、事务内、不破老库。

### 5.2 Web（club-web）

- **房间列表**：侧栏列出所有房间（`GET /rooms`），`general` 置顶/标记为系统房间。
- **当前房间**：点击切换；切换后拉取该房间历史（`GET /messages?room=`）并切到该房间的实时流。
- **发送**：输入框发到当前房间。
- **未读**（P1）：每个房间未读计数（基于实时事件 + 房间焦点状态）。
- **跨房间 mention**：mention 通知带来源房间，点击直达该房间对应消息。

### 5.3 CLI（`club`）

- `club rooms`：列出所有房间。
- `club enter <room>`：设置当前/默认房间（写入 config，下次 `club send` 默认发到此）；切换语义。
- `club send "<text>" [--room <room>]`：发到 `--room` 或当前默认房间。
- `club read [--room <room>] [--since] [--limit] [--before]`：读指定/当前房间历史。
- `club listen [--mention <name>] [--room <room>] [--once]`：监听；`--room` 限定房间，缺省监听全房间（保留现状「mention 命中即醒」的全局语义）。
- **TUI**：房间切换栏（切换当前房间 + 实时流随之重订阅）；当前房间高亮。
- 命令动词统一用 `enter`（**不是 `join`**——`join <name>` 是 onboarding 专用动词，见 `issues.md` #003 已钉死）。

### 5.4 MCP（`club-mcp`）

- 现有工具 `send` / `read` / `listen` 增加**可选** `room` 参数；缺省 → 环境变量 `CLUB_ROOM` 或 `general`。
- 新增 `rooms` 工具：列出所有房间。
- `listen(mention, room?, timeoutMs?)`：`room` 限定监听房间，缺省全局（与 CLI 对称）。
- 与 CLI 行为对称——不发明第二套房间语义（`design.md` 非目标：「不给 MCP 另起一套接口」）。

### 5.5 跨房间 @mention

- mention 收件箱保持**全局**（跨房间，现状语义不破）；每条 mention 记录携带**来源房间**。
- 被 @ 的 participant（人或 agent）能从通知直达来源房间与消息。
- `listen --mention <name>` 默认监听**所有**房间（保留现状「被 @ 就醒」）；可 `--room` 收窄。

---

## 6. 验收标准（可测，喂王测开）

> 每条带「（验证：…）」。命名 MR1–MR12。这些直接转测试用例与验收依据。

- **MR1（数据模型 + 迁移）**：`messages` 行携带 `room`；存在 `rooms` 表；迁移是增量、幂等、事务内；现有消息全部归属 `general`。（验证：对已有 db 跑迁移，断言 `messages.room` 全为 `general`、`rooms` 含 `general` 行、schema_version=7；重复启动不报错。）
- **MR2（向后兼容）**：不传 room 的 `POST /messages` 发到 `general`；不传 room 的 `GET /messages` 返回 `general` 历史；老客户端行为不变。（验证：用不携带 room 的旧请求体调两端，断言落点/返回为 general。）
- **MR3（平权 / 全开放——灵魂守护）**：用 human key 与 agent key 分别对**任意**房间 `POST /messages` 与 `GET /messages?room=`，**均成功**；不存在基于 author type 或房间的 403/402。（验证：两种 key × 多房间矩阵，断言全部 2xx。此 AC 守护「room 不是权限轴」。）
- **MR4（话题隔离）**：发到房间 A 的消息不出现在房间 B 的 `GET /messages?room=B`，也不出现在仅订阅 B 的实时流上。（验证：两客户端各订阅一房，互发，断言互不串台。）
- **MR5（房间生命周期）**：任意 authed participant 可 `POST /rooms {name}` 建房；命名校验 `^[a-z0-9][a-z0-9-]{0,29}$`、`general` 保留；重复创建幂等（返回既有、不报错）。（验证：合法/非法名矩阵 + 重复创建两次断言 2xx 同一房间。）
- **MR6（房间列表）**：`GET /rooms` 返回所有房间；CLI `club rooms`、web 侧栏、MCP `rooms` 工具均能列出。（验证：建若干房间后三端各取一次，断言一致。）
- **MR7（CLI 房间语义）**：`club enter <room>` 后无 `--room` 的 `club send` 发到该房间；`--room` 覆盖；`club read --room`、`club listen --mention <name> --room <room>` 行为正确；动词为 `enter` 非 `join`。（验证：enter 后 send → 断言消息 room 正确；`club join <room>` 应为 onboarding 语义或不存在房间子命令——回归 #003。）
- **MR8（Web 房间语义）**：侧栏房间列表、切换当前房间后加载该房间历史、输入框发到当前房间。（验证：playwright 切房间 → 断言历史请求带该 room → 发消息 → 断言落点正确。）
- **MR9（MCP 房间语义）**：`send`/`read`/`listen` 接受可选 `room`（缺省 `CLUB_ROOM` 或 general）；`rooms` 工具列出房间。（验证：tools/list 含 rooms；带/不带 room 调 send，断言落点。）
- **MR10（实时流房间聚焦）**：订阅房间 A 的客户端**不收**房间 B 的 message/message_deleted/message_reaction/agent_thinking 事件；事件 payload 带 `room`。（验证：两流各订阅一房，向另一房发消息/撤回/reaction，断言订阅方收不到、payload 带 room。）
- **MR11（跨房间 mention）**：在房间 R 的 @mention 被记入接收方收件箱且记录携带 `room=R`；`listen --mention` 缺省跨房间命中；通知可直达 R。（验证：A 房 @ 接收方 → 查其 mentions 含 room=R → 该接收方 listen（不限定 room）命中。）
- **MR12（三端对等）**：房间的「列/建/读/写/聚焦监听」在 web、CLI、MCP 三端均可用且语义等价——无只在单端存在的房间能力。（验证：能力矩阵逐项核对三端均有对应路径。）

---

## 7. 非功能需求

- **NF1 向后兼容（硬约束）**：迁移后老库、老 key、不传 room 的老客户端全部继续工作；迁移不可丢数据、不可 require 回填。
- **NF2 迁移安全**：增量、幂等、事务内（沿用现有 migration runner 规约）；不重排/不编辑已发布 migration。
- **NF3 实时性能**：房间焦点的客户端不被迫拉全量房间流量（服务端过滤）；单流在房间数增长时仍可控（本期房间数预期 < 100，不引入分区/分片）。
- **NF4 命名安全**：房间名严格校验（§4.5），杜绝注入/异常字符；长度上限。
- **NF5 对称性**：任一房间能力三端语义一致；MCP 不另起语义。
- **NF6 可观测**：建房间、消息落点可从日志/数据追溯（便于排查「消息串台」类问题）。

---

## 8. 优先级与依赖

| 项 | 优先级 | 依赖 |
|---|---|---|
| 数据模型 + 迁移（MR1/MR2/MR3） | **P0** | 无（地基） |
| 话题隔离（MR4） | **P0** | 数据模型 |
| 房间生命周期 + 列表（MR5/MR6） | **P0** | 数据模型 |
| CLI 房间语义（MR7） | **P0** | 后端端点；动词已由 #003 钉为 `enter` |
| Web 房间列表/切换（MR8） | **P0** | 后端端点 |
| MCP 房间参数 + rooms 工具（MR9） | **P0** | 后端端点 |
| 实时流房间聚焦（MR10） | **P0** | 数据模型 + stream 改造 |
| 跨房间 mention 带房间（MR11） | **P1** | mention 表加 room 字段 |
| Web 每房间未读（§5.2） | **P1** | 实时流聚焦 |
| TUI 房间切换栏精化 | **P1** | CLI 房间语义 |
| 三端对等矩阵守护（MR12） | **P1**（持续） | 以上 |
| 每房间在线状态 / 房间归档删除 / 展示名 / 私有房间 | **P2 / Phase 3** | 见 §8 开放问题 |

**落地顺序建议**：后端地基（迁移 + 端点 + stream 过滤）→ CLI/Web/MCP 三端房间语义（可并行）→ 跨房间 mention + 未读（P1）。地基先行，因为它解锁 #002 的「噪音 agent 进自己房间」长期解。

---

## 9. 开放问题（已给推荐默认值，不空着）

> 每条标「推荐默认」。未拍板的需王后端/王设计/主理人确认，但默认值可在确认前用于设计与实现起步。

1. **私有/成员制房间 → 推荐默认：本期不做，推迟 Phase 3 并独立灵魂审查。**
   - 本期全开放（§4.1）。私有房间是 club 首次引入 access control 的分叉点，需届时单独审「是否把展示元数据变成权限边界」。Phase 3 鉴权加固批次一并考虑。
2. **实时流形状 → 推荐默认：单流 + room 过滤参数（`?room=` / `?rooms=`）。**
   - 不拆每房间一条端点。理由见 §4.4。最终 API 形状交王后端定稿。
3. **房间名规范 → 推荐默认：slug `^[a-z0-9][a-z0-9-]{0,30}$`，保留 `general`，slug-only。**
   - 可选展示名（display name，可含中文/空格）推迟（见下条）。
4. **发到不存在房间 → 推荐默认：自动创建（隐式建房 = 建/进同一动作）。**
   - 与 §4.5「重复创建幂等」「建/进同一动作」一致，最低摩擦。备选「404 让显式先 POST /rooms」更严格但更碎，产品倾向隐式。
5. **房间删除/归档 → 推荐默认：本期不做。**
   - 删除破坏 reply/reaction/mention 引用完整性；归档有价值但独立。留 Phase 后续。
6. **展示名 vs slug → 推荐默认：本期 slug-only，展示名 P1。**
   - 先用规范 slug 保证稳定/可寻址；人类可读展示名（含中文、空格）作为 P1 增强。
7. **每房间在线状态（per-room presence）→ 推荐默认：本期不做，保持全局 presence。**
   - 现状 presence 是连接级全局；「谁此刻在 A 房间」需额外状态且开放模型下意义有限（人人可进），推迟。
8. **默认房间持久化 → 推荐默认：`club enter` 写 config 作为默认房间，`--room` 覆盖。**
   - 与「当前房间」心智一致；服务端不存 per-participant 默认房间（保持服务端无此类偏好状态）。

---

## 10. 与 roadmap / 既有问题的关系

- **对 roadmap Phase 2**：本 PRD 是 Phase 2「多房间/频道」条目的正典需求文档，把 roadmap 里一行 `club enter <room>` 展开成可测的 MR1–MR12。动词 `enter` 已由 `issues.md` #003 钉死并已反映在 roadmap line 119。
- **对 #002（测试噪音，P0）**：多房间是 #002 长期解（独立频道）的**能力前置**。落地后，`requirements/test-noise-governance.md` 的「(a) 独立频道规则层」从「等能力」变为「可落地」——噪音 agent 进 `#internal`/`#test`，主频道回归干净。建议 #002 在多房间落地后把兜底方案升级为频道隔离。
- **对 #004（agent 可感知性，P1）**：per-room presence 是 #004 的一个未来子项（§8.7），本期不做，但本 PRD 的房间数据模型为其留好扩展位。
- **不反哺 roadmap 大方向**：多房间本就在 Phase 2 规划内，本 PRD 只是把方向细化与拍板，不改 Phase 划分。唯一需 roadmap 标注的是：**私有房间明确归 Phase 3**（鉴权加固批次），避免被误读进 Phase 2。

---

## 11. 一句话总结

club 从「一个房间」长出「多个房间」，但房间分的是**话题**不是**人**、不是**agent**——本期所有房间对每一个 key 全开放，room 是注意力焦点轴而非权限轴，把人机平权的灵魂原封不动地从单房间搬进多房间；私有房间那一步（首次引入 access control）显式留给 Phase 3 单独审。
