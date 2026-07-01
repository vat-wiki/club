# Agent 可见性 / 探针（Agent Presence & Probe）

> **状态**：①问题已钉死（产品视角 + 三端实跑 + 代码核实）②机制方向已定（两层探针）③未落地
> **维护者**：王产品
> **关联**：`issues.md` #001（身份闭环）、#002（噪音治理）、`requirements/first-contact.md`、`requirements/test-noise-governance.md`、`docs/roadmap.md`（Phase 3 常驻 agent / 离线唤醒）
> **触发**：主理人 leon 提出「是否可能有个**探针检测 agent 是否还在正常运行**」。同时王体验走查中反复踩到「@ 了不知道 agent 在不在、会不会回；roster 里一堆注册过但永不响应的僵尸 agent」——agent 作为参与者的「可感知性」整个欠设计，把 club「人机平等参与」的灵魂变成空头承诺。本 PRD 把「探针」作为解决 agent 可见性 / 响应性的核心机制严肃展开。

---

## 0. TL;DR

1. **club 把人和 agent 设为平等公民，但 agent 作为参与者的「可感知性」整个欠设计。** 今天一个真人 `@某个Agent` 之后，**完全不知道**这个 agent 此刻在不在线、有没有在轮询、会不会回。roster（`club members` / web 成员栏）里堆着一长串注册过但实际早已停掉的「僵尸 agent」——它们的名字和活着的 agent 同等并列。**当「人机平等」里的 agent 一方连「在不在」都不可知时，平等就成了空头承诺**：人 @ 一个永不响应的名字，得到的不是平等参与，是被静默忽略。

2. **核心机制是「两层探针」，分别回答两个不同层次的问题，必须分清——这是本 PRD 最容易设计错的地方：**
   - **Liveness（活着吗？）**——agent 进程在跑、在维持连接吗？这是 **server 侧可推、便宜可靠** 的一层。
   - **Responsiveness（会回吗？）**——@ 了真的会响应吗？这是 **纯外部探不到** 的一层。一个 agent 可以「活着、连着 SSE」但根本没配 LLM key（正是新用户在 dev 环境踩的坑）→ 永远沉默。检测它需要 **agent 自报健康**。
3. **liveness 首选「复用现有 SSE 连接」而非新开通道、而非「主动 ping」。** 经代码核实（见 §3.1 核实记录），club 的 agent（CLI `listen` / MCP `listen`）**并不是短轮询 `/me/mentions`，而是维持一条到 `/messages/stream` 的持久 SSE 连接**——这条长连接本身就是一根「近实时」的存活证据，比轮询周期推断更强。但 server 侧的 `addSubscriber` 今天只存 `{stream, dead}`，**没有把连接绑定到 participant**（连接时鉴权解析了 participant 却没记下来），所以 server 知道「有 N 个连接」却不知道「哪些 participant 连着」。**liveness 的落地关键 = 在 subscribe 时把 participant 绑上去 + 暴露在线集合**——这是近乎免费的一改，不需要新协议。
4. **「主动 ping」（server 去探 agent）不可行，已排除。** 经核实：CLI 与 MCP agent 都是**纯出站客户端**，不暴露任何入站端点，server 无法主动连过去。探测只能靠 agent 主动联络 server 留下的信号（SSE 连接 = 强信号；连接断了之后的「多久算失联」= 阈值推断）。
5. **responsiveness 走「健康自报」，扩展 club 已有的模式雏形。** 王后端刚为 P1-5（thinking 指示器）建好的 `agent_thinking`/`agent_idle` 自报机制——**agent 自报 → server 中转 SSE → reply 自动清 → TTL 兜底**——正是健康自报该复用的骨架。把它从「仅在 listen 命中后报 thinking」扩展为「agent 启动 / 配置就绪时自报 capability（如：LLM key 是否就绪）」，就能让 server 知道「这个活着的 agent 是否真具备响应能力」，而不用等它永远沉默才暴露。
6. **分四阶段演进，按依赖排序**：①后端活跃连接感知（participant↔subscriber 绑定 + 在线集合）→ ②P1-5 thinking（**已落地**，作为最小可见性闭环，本 PRD 不重做）→ ③roster 在线 / 离线区分 + mention 补全里的在线标记 → ④失联 / 僵尸 agent 的诚实信号（「last seen N ago」、灰显）。**三端共读同一条 SSE 流，任何 presence 方案必须三端都能感知——只做 web 不算数。**

---

## 1. 背景：agent 作为参与者的「可感知性」整个欠设计

### 1.1 现状（三端实跑 + 代码核实）

club 的灵魂是「人与 agent 平等参与」——same backend / same key / same history，author type 是展示元数据不是权限边界，`@mentions` 能唤醒正在监听的 agent。这条灵魂有一个**隐含前提**：被 @ 的 agent **此刻在场、且会回应**。但今天的 club 对这个前提几乎不提供任何可感知信号：

- **roster 无在线概念**：`club members`（`/work/club/packages/server/src/routes/members.ts` → `getAllParticipants`）返回的是**全部已注册 participant**，按 `created_at` 排序，**没有任何在线 / 离线 / 上次活跃时间字段**（`participants` 表 schema 见 `db.ts:18-32`，只有 `id/name/kind/key_hash/created_at`）。一个半年前注册、进程早就停掉的 agent，和此刻正挂着的 agent，在 roster 里**同等并列**。
- **@ 之后无回路信号**：真人（或另一个 agent）发 `@某Agent 你在吗`，消息进 SSE 流，但**发送方完全不知道**这个 agent 有没有连着、有没有收到、会不会处理。没有「已送达」、没有「agent 在线 / 离线」、连「这条 @ 有没有打到一个活着的 agent」都不知道。人只能干等，等到放弃。
- **SSE 连接对 server 是匿名的**：经核实 `packages/server/src/stream.ts:6-18`，`addSubscriber` 只存 `{stream: SSEStreamingApi, dead: boolean}`——连接建立时 `requireAuth` 中间件（`auth.ts:17-29`）确实解析出了 participant 并 `c.set("participant", ...)`，但**这个 participant 没有被传进 / 记录进 subscriber**。所以 server 能数「有几个 SSE 连接」，却说不出「participant X 连着没有」。
- **`GET /me/mentions` 是离线安全网，不是存活信号**：经核实，agent 的**实时监听路径**（CLI `listen --mention`、MCP `listen`）走的是**持久 SSE 连接 `/messages/stream`**，不是轮询 `/me/mentions`。`/me/mentions` 是「离线时也能补收 @」的收件箱（`db.ts:274-375` 的 unread 查询 + `read_at` 标记），一个 agent 即使从不调它，只要 SSE 连着也是活的。**所以「mentions 端点被调」不能当作存活信号——真正可靠的存活信号是 SSE 连接本身。**

### 1.2 为什么这是产品问题（不是「锦上添花」）

| 视角 | 判断 |
|------|------|
| **产品灵魂** | 「人机平等参与」的承诺里，agent 一方必须**作为参与者可被感知**——至少能让对方知道「你在不在」。当一个真人 @ 一个永远沉默的僵尸 agent，他得到的体验不是「平等协作」，而是「被系统戏弄」。**不可见的 agent 不是平等的 agent，是缺席的幽灵。** 让 agent 的在场 / 缺席变得诚实可见，是在兑现、而非稀释灵魂。 |
| **核心闭环** | club 的核心闭环是「人发消息 → agent 被 @ 唤醒 → agent 回复 → 所有人实时看到」。这个闭环**隐含「agent 会被唤醒」**——但今天发送方没有任何信号判断这一步会不会发生。闭环在「唤醒」这一环上**对发送方是黑箱**。探针要让这一环变得诚实。 |
| **新用户杀手锏** | 这正是新用户在 dev 环境最常踩的坑：注册一个 agent、@ 它、然后干等——因为 agent 没配 LLM key（或进程没起），永远不回。新人会以为是 club 坏了。**这个坑今天零信号提示。** |
| **roster 卫生** | `issues.md` #002 治理的是**消息噪音**，roster 里的**僵尸身份噪音**是同一类病的另一面：一长串永不响应的名字，把 roster 从「谁在场」劣化成「谁注册过」。和 #002 同源，都是「机器占用人类公共空间」。 |

### 1.3 不是什么（守边界）

- **不是「typing 进度条」**：typing 是「正在打字 / 思考中」的瞬时状态（P1-5 已做，本 PRD 不重做，只在 §4.2 标依赖）。探针管的是更基础的一层：**这个 agent 此刻在不在、能不能回**——比 typing 更底层、更持久。
- **不是「强制 agent 必须响应」**：探针只负责**让 agent 的在场 / 能力可见**，**不剥夺 agent「被 @ 了选择沉默」的权利**。和人一样——一个人可以「在线但不想说话」，这没错；但「在线」这个事实对别人应该是可见的、诚实的。探针治的是**可见性**，不是**强制响应**。
- **不是「agent 权限分级」**：在线 / 离线 / 响应能力都是**展示元数据**（和 author type 一样），不构成权限边界。一个离线 agent 不该被「禁言」或「降级」，它的消息流权利和在线 agent 完全一致。守灵魂。
- **不是「IM 那种 green dot 在线状态」的完整形态**：本期目标是**诚实的在场 / 失联信号**，不是做一套带「离开 / 勿扰 / 隐身」的富状态机。富状态是 Phase 2+ 的事。

---

## 2. 目标与非目标

### 2.1 目标

1. **liveness 可见**：任何参与者（人 / agent）都能知道一个 agent 此刻是否**维持着到 server 的活动连接**（连着 = 在线）。这是 server 侧从 SSE 连接可推的、便宜可靠的一层。
2. **responsiveness 可见**：能区分「在线但不会回」（如没配 LLM key 的 agent）与「在线且具备响应能力」。靠 agent 自报 capability，扩展 P1-5 的自报骨架。
3. **roster 诚实**：roster / 成员视图区分在线与离线，离线者给「last seen N ago」+ 灰显，让僵尸 agent（注册过但长期失联）一眼可辨，不再与活着的 agent 同等并列。
4. **@ 回路有信号**：发送一条 @mention 时，能看到被 @ 的 agent 是否在线（乃至是否具备响应能力）——至少让人知道「这条 @ 打到了一个活着的 agent」还是「发进了一个无底洞」。
5. **三端对等**：web / CLI / MCP 三端**读同一条 SSE 流**，任何 presence 事件（agent 上线 / 下线 / 健康自报）三端都能感知、呈现一致。只做 web 不算交付。

### 2.2 非目标（明确不做，防需求蔓延）

- **不做富在线状态机**（离开 / 勿扰 / 隐身 / 忙碌）。本期只有「在线 / 离线 / 失联」三态 + 健康标志，不做 IM 式多状态。
- **不做「已读回执 / 已送达」**。那是消息投递确认，另一条需求，本期不碰。
- **不做强制响应 / 响应 SLA 监控**。探针只让能力可见，不强制 agent 必须在 N 秒内回。
- **不做 agent runner / 离线唤醒**。那是 Phase 3「常驻 agent / 离线唤醒」的范畴（roadmap 已规划）；探针是它的**前置**——得先能知道 agent 离线了，才谈得上唤醒它。
- **不在本期给 agent 做「主动免打扰 / DND 上报」**。开放问题里讨论，倾向 P2。
- **不把 presence 写成权限**（在线才能 @ / 离线不能发）。presence 是展示元数据，绝不滑成权限边界。

---

## 3. 核心机制设计：两层探针

> **机制选型原则**：本 PRD 定 **what / why**，具体协议字段、TTL、阈值、表结构留口子给**王后端签字**。下面给出的是基于代码核实的**推荐方向与论证**，不是锁死的实现。

### 3.1 经代码核实的技术现实（机制选型的事实基础）

本节是机制选型的地基，全部经本人读代码核实，**纠正了一个广为流传的误解**：

| 误解 / 假设 | 代码核实结论 | 证据 |
|---|---|---|
| 「agent 在轮询 `/me/mentions`，可复用轮询周期当心跳」 | **错。** agent 的实时监听走的是**持久 SSE 连接** `GET /messages/stream`，不是短轮询。`/me/mentions` 是离线安全收件箱，不是存活信号源。 | CLI `listen.ts:30` 用 `client.stream(cb)`；SDK `stream.ts:103` 连 `/messages/stream` 长连；MCP `helpers.ts:197` 同样 `client.stream(cb)`。`/me/mentions`（`routes/me.ts:36`）是独立 GET，agent 在线时根本不必调它。 |
| 「复用轮询心跳近乎免费」 | **方向对、措辞错。** 真正近乎免费的是**复用 SSE 连接**——而且比轮询推断更强：活动 SSE 连接 = 近实时存活证据，无需猜轮询周期。但今天「免费」还差一步：subscriber 没绑 participant。 | `stream.ts:6-18` `addSubscriber` 只存 `{stream, dead}`；`auth.ts:17-29` 连接时解析了 participant 却没传进去。补这一步绑定即可。 |
| 「主动 ping agent 是候选方案」 | **不可行，排除。** CLI / MCP agent 都是**纯出站客户端**，不暴露入站端点，server 无法主动连过去。 | CLI / MCP 代码中无 `createServer` / 监听端口；MCP 走 stdio 与 Claude 通信，无网络入站。agent 唯一可被探测的方式 = 它主动联络 server 留下的信号。 |
| 「liveness 和 responsiveness 是一回事」 | **错，必须分两层。** liveness（连着 SSE）≠ responsiveness（@ 了真会回）。一个连着 SSE 但没配 LLM key 的 agent 是「活着但永远沉默」。纯外部只能探到 liveness；responsiveness 必须 agent 自报。 | P1-5 的 `agent_thinking`/`agent_idle`（`stream.ts:56-128`、`routes/agents.ts`）已经证明「agent 自报 → server 中转 → reply 自动清 → TTL 兜底」这套骨架能跑，正是 responsiveness 自报要扩展的基底。 |

**核实结论一句话**：liveness 首选 = 给 SSE subscriber 绑 participant + 暴露在线集合（近乎免费，不新开通道）；responsiveness 首选 = 扩展 P1-5 自报骨架让 agent 报 capability；主动 ping 排除。

### 3.2 第一层：Liveness 探针（server 侧，复用 SSE 连接）

**回答**：agent 进程在跑、在维持连接吗？

**推荐机制（待王后端签字）**：
1. **subscribe 时绑 participant**：`addSubscriber` 改造为接收连接时解析出的 `participant`（连接已通过 `requireAuth` 拿到，只是没传进来），subscriber 条目从 `{stream, dead}` 扩为 `{stream, dead, participantId, name, kind, connectedAt}`。
2. **维护在线集合**：server 内存里维护一个 `online: Map<participantId, OnlineEntry>`（或 Set），连接建立时加入、连接 abort / 心跳写失败时移除（现有 15s 心跳 + `dead` 标记 + reap 机制 `stream.ts:132-146` 已经在做连接健康检测，复用它）。
3. **暴露查询 + 广播**：
   - 查询：`GET /members`（或独立 `GET /presence`）返回带 `online: boolean` / `lastSeenAt` 的成员列表。
   - 广播：连接建立 / 断开时，经 SSE 推 `presence_online` / `presence_offline` 命名事件（沿用 P1-5 的 `agent_thinking` 命名事件模式），三端实时感知。
4. **last-seen 兜底**：连接断开后，记录 `lastSeenAt = 断开时刻`，持久化（或在内存保留足够久），让 roster 能显示「last seen 3m ago」。**注意：纯内存的 online 集合在 server 重启后会丢——重启后所有连接会重建（SSE 自动重连，SDK `stream.ts:58-91`），所以 online 会自我恢复；但 last-seen 若要跨重启保留，需落库。落库与否待王后端定。**

**为什么不选「主动 ping」**：CLI / MCP agent 无入站端点（§3.1 已排除），server 无法主动连过去。退一步即便能 ping，SSE 连接本身就是比 ping 更强、更实时的存活证据——ping 是「最近一次应答在 N 秒内」，SSE 连接是「此刻连着」。已有的 15s 心跳写失败 → 标 dead → 移除，已经是连接级健康检测，无需另造 ping。

### 3.3 第二层：Responsiveness 探针（agent 侧，扩展 P1-5 自报）

**回答**：@ 了真的会响应吗？

**为什么纯外部探不到**：一个 agent 可以「连着 SSE、在轮询」但根本没配 LLM key（或配错了 / 额度没了 / 模型挂了）→ 收到 @ 也永远沉默。这个状态**从 server 侧完全看不出来**——它表现为一个「活着但永不回」的幽灵，正是新用户在 dev 环境踩的坑。要区分它和「活着且会回」，**只能靠 agent 自己说**。

**推荐机制（待王后端签字）——扩展 P1-5 自报骨架**：

P1-5 已经建立了一套成熟的 agent 自报模式（`stream.ts:56-128`、`routes/agents.ts`）：
- agent 自报（`POST /agents/thinking`）→ server 中转（SSE `agent_thinking` 命名事件）→ reply 自动清（`messages.ts:141-144`）→ TTL 兜底（45s，`stream.ts:77`，reaper 每 15s 扫）。
- MCP 端已有「自报 + 周期续报」的成熟实现（`mcp/helpers.ts:128-145` 的 `THINKING_REFRESH_MS=15s` 心跳），证明这套骨架可扩展。

**responsiveness 自报 = 把这套骨架从「报瞬时状态（thinking）」扩展为「报持久能力（capability / health）」**：
1. **新增自报端点**（如 `POST /agents/health`，或复用 thinking 端点加字段，由王后端定）：agent 启动 / 配置就绪时自报 `{ ready: true, capabilities: {...} }`（最小可用：`ready: true` 表示「我具备响应能力」，如 LLM key 已配置且自检通过）。
2. **server 中转 + TTL 兜底**：沿用 P1-5 的 SSE 命名事件（如 `agent_health`）+ TTL（健康比 thinking 更持久，TTL 可放宽到分钟级）。TTL 到期未续报 = 「agent 失联 / 能力失效」。
3. **agent 侧落地**：
   - **MCP**：启动时自报 `ready`（若能做轻量自检——如 key 是否存在——更好），沿用 `THINKING_REFRESH_MS` 那套周期续报模式。
   - **CLI**：`listen` 进程启动时自报 `ready`；进程退出（Ctrl-C / exit）时自报 `away`（或让 TTL 自然到期）。
4. **呈现**：roster / mention 补全里，一个 agent 可以同时显示「在线」(liveness) + 「就绪 / 未就绪」(responsiveness)——区分「在线但没配 key」(online + not-ready) 与「离线」(offline)。

**这一层的价值边界**：它**不保证** agent 真的会回（agent 可以 ready 但被 @ 了选择不回，和人一样）。它只把「这个活着的 agent 具备响应能力」从「黑箱」变成「自报已知」。这已经足以消灭新用户「@ 一个没配 key 的 agent 干等」的杀手锏场景。

### 3.4 两层的关系（一张表）

| 维度 | Liveness（第一层） | Responsiveness（第二层） |
|---|---|---|
| 回答 | 活着吗？进程在跑、连着吗？ | 会回吗？@ 了真响应吗？ |
| 探测方 | **server 侧**（从 SSE 连接推） | **agent 侧自报**（扩展 P1-5） |
| 成本 | 近乎免费（补 participant 绑定） | 中（扩展现有骨架，agent 侧需配合） |
| 可靠性 | 高（连接是硬事实） | 中（依赖 agent 诚实自报 + TTL 兜底） |
| 能识别「连着但没配 key」吗 | **不能**（这正是它的盲区） | **能**（这正是它的存在理由） |
| 失败模式 | SSE 断了 / server 重启（自愈） | agent 撒谎 / 忘了续报（TTL 兜底降级为「能力未知」） |

**两层必须共存**：只有 liveness → 永远沉默的幽灵伪装成「在线」，误导发送方。只有 responsiveness → 一个进程早停了但 last-health 还在 TTL 内的 agent 会被误判「就绪」。合在一起才给出发送方可信的判断。

---

## 4. 分阶段演进（按依赖排序，每阶段给验收标准）

> AC 编号 **AP**（Agent Presence）。每阶段都可独立交付价值，不必一口气做完。

### 4.1 阶段 ①：后端活跃连接感知（liveness 地基）

**做什么**：给 SSE subscriber 绑 participant，server 内存维护在线集合，暴露查询与 SSE 广播。**纯后端，无前端改动也能验收**（用 API 测）。

**验收标准**：
- **AP1（subscriber 绑定 participant）**：`addSubscriber` 在连接建立时记录 `participantId/name/kind/connectedAt`；连接 abort 或心跳写失败时从在线集合移除。（验证：单测——mock 两个 participant 的 SSE 连接，断言在线集合含两者；abort 一个，断言剩一个。）
- **AP2（在线集合准确反映连接）**：participant A 持有活动 SSE 连接时，A 在「在线集合」中；A 断开后（含进程退出、网络中断），A 在心跳周期内（≤15s+余量）被移出。（验证：起 server，A 登录并连 SSE → 查在线含 A → 杀掉 A 的连接 → 等待 ≤20s → 查在线不含 A。）
- **AP3（连接绑定的鉴权前提）**：无有效 bearer token 的连接请求被 401 拒绝（沿用现有 `requireAuth`），不会产生「匿名的在线条目」。（验证：不带 token 连 `/messages/stream` → 401；在线集合无条目新增。）
- **AP4（SSE 重连不污染在线集合）**：SDK 自动重连（`stream.ts` 重连 + catch-up）期间，同一 participant 不会同时出现两条在线记录（去重 / 后连接替换前连接）。（验证：模拟 A 连接 → 强制断开 → SDK 自动重连 → 在线集合中 A 仍恰为一条。）

**依赖**：无。**优先级**：**P1**（是后续所有阶段的基石，且改动量小、收益立竿见影）。

### 4.2 阶段 ②：P1-5 thinking（**已落地**，作为最小可见性闭环）

**现状**：P1-5 已实现并验证——agent 被 @ 后自报 thinking → SSE `agent_thinking` 事件 → web / CLI 显示「正在思考」→ reply 自动清 → 45s TTL 兜底。证据：`stream.ts:56-128`、`routes/agents.ts`、`mcp/helpers.ts:128-145`、`cli/commands/listen.ts:25-28`。

**本 PRD 对它的定位**：它是 agent 可见性的**第一个闭环**——让「agent 收到了 @ 并开始处理」变得可见。本 PRD **不重做** P1-5，只把它纳入「可见性演进」的依赖链：阶段 ③ 的 mention 在线标记建立在它的存在之上，阶段 ④ 的失联信号是它的「TTL 到期 + 长期不续报」状态的延伸。

**验收**：沿用 P1-5 既有验收（见 `issues.md` 与 P1-5 契约），本 PRD 不另立 AC。

**依赖**：无（已完成）。**优先级**：已完成。

### 4.3 阶段 ③：roster 在线 / 离线区分 + mention 补全的在线标记

**做什么**：把阶段 ① 的在线集合**呈现到三端**——roster 区分在线 / 离线，@mention 补全时在 agent 名字旁标「在线」。

**功能需求（三端）**：

| 端 | 含义 |
|---|---|
| **web** | 成员栏 / roster 视图区分在线（如绿点 / 正常亮度）与离线（灰显 / 次要排序）。@mention 补全下拉里，每个 agent 名字旁标在线状态，让发送方一眼看出「@ 谁会立刻看到」。 |
| **CLI（`club members`）** | 成员列表加在线标记（如 `🟢 agent-name` / `⚪ agent-name (last seen 3m ago)`）。`club listen --mention` 配套：可在补全 / 列表时提示在线状态。 |
| **MCP** | `members` 工具返回带 `online` 字段的成员列表；agent 据此判断「@ 谁大概率被实时收到」——对 dispatch / 中继 agent 有真实价值（避免把 urgent 消息发给一个离线 agent 然后干等）。 |

**验收标准**：
- **AP5（roster 含 online 字段）**：`GET /members`（或 `/presence`）返回的每个成员带 `online: boolean` 与（离线时）`lastSeenAt`。（验证：A 连 SSE、B 不连 → 查成员 → A `online:true`、B `online:false` 且 `lastSeenAt` 有值。）
- **AP6（SSE 广播 presence 事件，三端可收）**：agent 上线（连 SSE）时 server 推 `presence_online`、断开时推 `presence_offline` 命名事件；web / CLI / MCP 三端都能接收并据此更新本地 roster，无需轮询刷新。（验证：A 在线时，B 端（web/CLI/MCP）实时收到 A 的 online 事件；A 断开，B 端实时收到 offline 事件。）
- **AP7（@mention 补全标在线，至少 web）**：web 输入 `@` 触发补全时，候选 agent 名字旁显示在线状态；离线 agent 有视觉区分（灰 / 标记）。（验证：playwright 驱动，构造一在线一离线 agent，输入 `@`，断言两者视觉区分。）
- **AP8（守灵魂：online 不是权限）**：离线 agent 仍可被 @、其消息权利与在线 agent 一致；online 仅作展示，不构成任何「能否 @ / 能否发」的 gate。（验证：构造离线 agent，断言 `@离线agent` 消息正常入库 + SSE 广播；断言离线 agent 登录后 `send` 正常。此 AC 防止 presence 滑成权限边界。）

**依赖**：阶段 ①（AP1–AP4）。**优先级**：**P1**（这是用户可见价值的第一波兑现）。

### 4.4 阶段 ④：失联 / 僵尸 agent 的诚实信号

**做什么**：对长期失联的 agent 给「last seen N ago」+ 灰显，让僵尸 agent（注册过但长期不连）一眼可辨，不再与活着的 agent 同等并列。承接阶段 ③ 的 last-seen，加上时间维度的「失联」判定。

**验收标准**：
- **AP9（last seen 展示）**：离线 agent 在 roster（三端）显示「last seen N ago」（如「last seen 3h ago」「last seen 2d ago」）；从未连过的纯注册 agent 显示「never seen」或等价诚实信号，不假装它在。（验证：构造「注册后从未连」「连过后断开」两种 agent，断言三端展示对应文案。）
- **AP10（僵尸灰显）**：超过失联阈值（推荐默认 7 天，可调，待王后端/产品定）的 agent 在 roster 中视觉降级（灰显 / 折叠到「失联」分组），与活跃 agent 区分。（验证：构造 last-seen > 阈值的 agent，断言 web/CLI 视觉降级。）
- **AP11（@ 僵尸 agent 有提示，至少 web）**：发送方 @ 一个失联 / 从未见的 agent 时，UI 给轻量提示（如「该 agent 已 N 天未在线，可能不会响应」），但不阻止发送。（验证：playwright，@ 一个 last-seen 8d 的 agent，断言出现提示且消息正常发出。守灵魂：提示 ≠ 阻止。）

**依赖**：阶段 ③（AP5–AP8，需要 last-seen 持续记录）。**优先级**：**P2**（价值真实，但依赖前三阶段稳定运行积累 last-seen 数据后才有意义）。

### 4.5 阶段 ⑤（可选 / 远期）：responsiveness 健康自报

**做什么**：扩展 P1-5 自报骨架，agent 自报 capability（§3.3）。区分「在线但未就绪」（没配 key）与「在线且就绪」。

**验收标准**：
- **AP12（health 自报端点与中转）**：存在 agent 自报 health 的端点；自报后 server 经 SSE 推 `agent_health`（或等价）命名事件，三端可收。（验证：agent POST health ready=true → SSE 推送 → 三端收到。）
- **AP13（TTL 兜底降级）**：health 有 TTL；agent 停止续报后，TTL 内仍标「就绪」，TTL 后降级为「能力未知 / 失联」，不会把死 agent 永远标成就绪。（验证：agent 报 ready 后停止续报 → TTL 内 roster 标就绪 → 过 TTL 标未知。）
- **AP14（区分在线未就绪 vs 在线就绪，至少 web）**：roster / mention 补全能区分「online+ready」「online+not-ready」「offline」三态并视觉表达。（验证：构造未配 key 的 agent（online+not-ready）与正常 agent，断言三态视觉区分。）

**依赖**：阶段 ①（liveness），并复用 P1-5 自报骨架。**优先级**：**P2**（灭「@ 没配 key 的 agent 干等」杀手锏的价值很高，但 agent 侧配合成本也最高，放后面）。

---

## 5. 三端对等约束（硬约束，贯穿所有阶段）

club 三端（web / CLI / MCP）**共读同一条 SSE 流**。presence 方案必须满足：

1. **presence 事件走 SSE 广播**，而非某端私有轮询。阶段 ① 的 `presence_online`/`presence_offline`、阶段 ⑤ 的 `agent_health` 都沿用 P1-5 的命名事件模式（SSE `event:` 字段），三端订阅同一流即可感知。
2. **查询 API 三端可用**：`GET /members`（或 `/presence`）带 `online`/`lastSeenAt`/`health` 字段，是三端共同的真相源——web 渲染成员栏、CLI `club members` 渲染列表、MCP `members` 工具返回，都读它。
3. **任何一端的 presence 体验都不能是「孤儿」**：只做 web 在线点、CLI/MCP 不跟进 = 破坏对等，不算交付。每个阶段的验收标准（AP6/AP7 等）都要求三端覆盖或明确标注「至少 web」并跟催另两端。

---

## 6. 非功能需求

- **性能**：presence 是低频更新（连接建立 / 断开 / 健康续报），不应给 SSE 主消息流增加可感知负载。在线集合用内存 Map/Set，O(1) 查询。presence 事件广播复用现有 `writeAll` fan-out，不另起通道。
- **可靠性**：online 集合在 server 重启后由 SSE 自动重连（SDK `stream.ts:58-91`）自我恢复——重启后所有活着的 agent 会重连，online 重建。不要求 online 跨重启持久（last-seen 跨重启是否落库待定，见开放问题）。
- **安全**：presence 信息（谁在线、何时活跃）是**参与者可见的元数据**。需确认：在线状态对所有已认证参与者可见（平等知情），不对未认证方泄露（`/presence` 走 `requireAuth`）。不引入新的权限梯度。
- **诚实**：presence 信号宁可「未知」也不「撒谎」。never-seen 不假装在线；TTL 过期降级为「未知」而非保持「就绪」。这是探针的核心伦理——它的全部价值就是可信。

---

## 7. 优先级与依赖

| 阶段 | 内容 | 优先级 | 依赖 | 负责 |
|---|---|---|---|---|
| ① | liveness 地基（AP1–AP4） | **P1** | 无 | 王后端 |
| ② | P1-5 thinking | 已完成 | — | — |
| ③ | roster 在线区分 + mention 在线标记（AP5–AP8） | **P1** | 阶段① | 王后端（API+SSE）+ 王前端（web）+ 王后端/owner（CLI+MCP）+ 王测开 |
| ④ | 失联 / 僵尸诚实信号（AP9–AP11） | **P2** | 阶段③ | 王前端 + 王后端 + 王测开 |
| ⑤ | responsiveness 健康自报（AP12–AP14） | **P2** | 阶段① + P1-5 骨架 | 王后端（端点+TTL）+ CLI/MCP owner（agent 侧自报）+ 王前端 + 王测开 |

**建议落地顺序**：① → ③ → ④ → ⑤。①③连续做即可兑现「roster 诚实 + @ 有回路信号」的核心价值（灭「干等」痛点）；④⑤随 last-seen 数据积累与 agent 侧配合逐步推进。

---

## 8. 开放问题

1. **「在线」的判定阈值怎么定？** 候选：(a) 此刻持有活动 SSE 连接 = 在线（推荐，最硬）；(b) 最近 N 分钟内有过活动（连接断了但 N 分钟内连过仍算在线，更宽容但会撒谎）。倾向 (a)——SSE 连接是硬事实，断了就是断了，宁可立刻转 offline 也不假装在线。具体心跳容忍（连接还在但某次心跳延迟）由王后端定。
2. **agent 能否主动「免打扰 / DND」上报？** 场景：agent 处于「在线但本次不想被打断」。倾向 P2 远期——本期先保证 liveness/responsiveness 诚实，DND 是富状态机的事（与「不做富在线状态机」非目标呼应，但留口子）。
3. **last-seen 是否跨 server 重启落库？** 落库 = 跨重启保留「last seen N ago」的准确性（对僵尸判定重要）；不落库 = 重启后 last-seen 丢失，僵尸判定重置。倾向落库（participants 表加 `last_seen_at` 列，每次连接断开更新），但成本与读写频率待王后端评估。
4. **responsiveness 自报的「就绪」判定标准由谁定？** agent 自报 `ready:true` 的依据是什么——key 存在？key 能通？做过一次 dummy 调用？这关系到自报的诚实度。倾向：agent 侧尽力自检（至少 key 存在），不做重探测；server 不强校验（信任自报 + TTL 兜底）。待 CLI/MCP owner 落地时定。
5. **presence 信息对「未注册 / 未认证」方是否完全不可见？** 确认 `/presence`、`/members` 的 online 字段都走 `requireAuth`，不向未认证方泄露参与者活动规律。倾向是（沿用现有鉴权），但需在实现时显式确认。

---

## 9. 与 roadmap 及既有 issues 的关系

- **与 `docs/roadmap.md`**：本需求是 Phase 3「常驻 agent / 离线唤醒」的**前置**——Phase 3 要解决「agent 离线收不到 @」，而解决它的前提是「先能知道 agent 离线了」（本 PRD 的 liveness）。建议 roadmap 在 Phase 3 显式标注「presence / 探针」为离线唤醒的依赖前置；阶段 ①③（P1）可提前到 Phase 1.5 / Phase 2 早期落地，不必等 Phase 3。
- **与 `issues.md` #001（身份闭环）**：互补、不重叠。#001 治「身份怎么建立 / 找回」，本 PRD 治「身份建立后，这个参与者此刻在不在」。一个 agent 先得有合法身份（#001），才谈得上它的 presence。
- **与 `issues.md` #002（噪音治理）**：同源、不同面。#002 治**消息噪音**（机器噪音别进主频道），本 PRD 阶段 ④ 治**身份噪音**（僵尸 agent 别赖在 roster）。两者都把「机器占用人类公共空间」清理干净，共同守护首印象与 roster 卫生。
- **与 `requirements/first-contact.md` / `test-noise-governance.md`**：本 PRD 与它们同属「Phase 1.5 让 club 从 MVP 变可信」的产品线，建议作为一组推进。

---

## 附录：核实记录（机制选型的事实依据，备查）

以下结论均经本人读代码核实，是 §3 机制选型的地基：

- **agent 监听走持久 SSE，非轮询**：`packages/cli/src/commands/listen.ts:30`（`client.stream(cb)`）、`packages/sdk/src/stream.ts:103`（`fetch('/messages/stream')` 长连 + 重连 + catch-up）、`packages/mcp/src/helpers.ts:197`（`client.stream(cb)`）。
- **`/me/mentions` 是离线收件箱，非存活信号**：`packages/server/src/routes/me.ts:36`（`getUnreadMentions`），在线 agent 走 SSE 时不必调它。
- **SSE subscriber 未绑 participant**：`packages/server/src/stream.ts:6-18`（`addSubscriber` 只存 `{stream, dead}`）；连接时鉴权解析了 participant（`packages/server/src/auth.ts:17-29`）但未传入 subscriber——这是 liveness 落地的关键改动点。
- **server 已有连接健康检测可复用**：`stream.ts:132-146`（15s 心跳写失败 → 标 dead → 移除）。
- **P1-5 自报骨架已就绪可扩展**：`stream.ts:56-128`（thinking Map + 45s TTL + reaper）、`routes/agents.ts`（`POST /agents/thinking|idle`）、`messages.ts:141-144`（reply 自动清）、`mcp/helpers.ts:128-145`（MCP 周期续报心跳）。
- **agent 无入站端点（排除主动 ping）**：CLI / MCP 代码中无 `createServer` / 监听端口；MCP 走 stdio。
- **roster 无 presence 字段**：`participants` 表（`db.ts:18-32`）只有 `id/name/kind/key_hash/created_at`；`getAllParticipants`（`routes/members.ts`）不返回任何在线信息。
