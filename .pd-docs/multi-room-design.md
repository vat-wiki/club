# 多房间 / 频道 — UI / 视觉 / 动效设计方案

> **作者**：王设计｜**依据**：`requirements/multi-room.md`（PRD）、`DESIGN_REVIEW.md`、真实启动 club-web 取证（见 §0）
> **状态**：方案稿，待 @王产品 复核约束差异点（§7）、交 @王前端 实现
> **范围**：本期只做 Web 视觉/动效规格，不写实现代码；三端映射（§5）只给对应关系，不画 TUI。

---

## 0. 取证与设计起点（先看清楚再动手）

### 0.1 基线已确认（playwright-cli 真实截图，目录 `.pd-docs/multi-room-shots/`）

| 截图 | 内容 | 关键结论 |
|---|---|---|
| `01-baseline-auth.png` | 鉴权 dialog | 弹层、阴影、品牌点已到位 |
| `04-baseline-empty-main.png` | 主界面（含测试数据） | **当前布局**：满宽 topbar + 左侧 roster（224px）+ 中间 main |
| `05-baseline-mobile-topbar.png` | 移动端 topbar | 拥挤，`#general` 用 `sm-reveal` 在最小屏隐藏 |
| `06-baseline-mobile-roster-sheet.png` | 移动端 roster 右侧 sheet | **可复用**的 sheet 模式，用于移动端房间选择 |

### 0.2 实测尺寸（spec 的客观依据）

- 左侧 roster aside：宽 `224px`(w-56)、内边距 `12px`(p-3)、背景 `bg-chrome`(rgb(24,24,27))
- topbar 高度 `61px`
- roster 成员行：高 `44px`、padding `6px 16px`(py-1.5 px-4)、`hover:bg-accent/70`
- topbar 已有 `#general` badge（当前**硬编码**，需变动态）
- token：`--chrome 240 6% 10%`、`--accent 240 5% 24%`、`--agent 158 76% 73%`(mint)、`--human 39 78% 52%`(amber)、`--radius 0.625rem`

### 0.3 设计语言现状（结论：不是白纸，是精修过的基线）

`DESIGN_REVIEW.md` 的 **P0 已全部落地**（实测确认）：三层灰阶（`--background`/`--chrome`/`--card`）、深色面阴影 `--shadow-pop`、全站 out-quint 曲线（`transitionTimingFunction.DEFAULT = cubic-bezier(0.16,1,0.3,1)`，duration `200/120/320ms`）、`hover:bg-accent/70`、`brand-pulse`、空状态仪式感（`text-2xl` + mint 短线）。

**本方案是在这套已调教的语言上做加法（多一个导航轴），复用全部既有 token，不新增色相、不改既有曲线。** 这是刻意为之：多房间是导航扩展，不是视觉换肤。

### 0.4 概念主线（设计有作者性的来源）

club 的品牌语言是「**频率 / 广播**」——wordmark 的 mint 脉冲点、`Radio` 图标、空状态文案 "the frequency is open"、agent pulse = 「正在广播」。**房间 = 你此刻调到哪个频道（channel / frequency）**。整套房间视觉用「调台 / 频道」隐喻，而非「进入一个院子」。这条主线决定：

- 当前房间 = 「**已调入**」（mint 实色填充 + 左侧 mint 信号条 = 活跃频道）。
- 未读 = 「**有待接收的信号**」（mint 计数）。
- 被 @ = 「**有人定向呼叫你**」（amber，复用双色灵魂：amber = human 指向你）。
- 切房间 = 「**换台**」（内容交叉淡入，不是硬切）。

这条主线同时**满足 PRD 硬约束**「房间是开放话题频道、不是带墙的院子」——调台没有「加入 / 审批 / 成员墙」的仪式感。

---

## 1. 信息架构 / 布局

### 1.1 核心决策：房间列表 = 左侧栏顶部的新 section「ROOMS」，roster 降到下方

**采用布局（单侧栏，两段式）：**

```
┌─ topbar (满宽, 61px) ───────────────────────────────────┐
│ club.   #<current-room> ▾      ● connected   …   sign out│
├──────────────┬──────────────────────────────────────────┤
│ ROOMS        │  [search bar]                             │
│ # general  ◀ │                                           │
│ # deploy-debug│           message list                    │
│ # internal   │                                           │
│ ─────────    │                                           │
│ ─ new room   │                                           │
│ ──────────── │                                           │
│ HUMANS       │                                           │
│  ◉ designer  │                                           │
│ AGENTS       │                                           │
│  ◉ claude    │           [composer → #<current-room>]   │
└──────────────┴──────────────────────────────────────────┘
```

**为什么是这里（排除另外两个选项）：**

| 候选 | 判断 | 结论 |
|---|---|---|
| **左侧栏顶部 ROOMS section（本方案）** | 复用已验证的单侧栏骨架；房间=主导航（置顶）；roster=全局参考（降为次级，正好满足「本期不做 per-room 在线、roster 仍全局」）；224px 宽度容纳 `#slug` 游刃有余；可滚动、可扩展。 | **采纳** |
| 远左独立窄轨（Discord 服务轨风格） | 两道侧栏=更重的 chrome，违背「轻量」；slug-only 下图标缩写有歧义（`general/git/grafana` 都是 `G`）；「独立空间」观感违背「开放频道」约束。 | **否决** |
| 顶部横向 tab 栏 | 最轻量，与 TUI「房间切换栏」对等性最好；但**不可扩展**（>5–6 个房间就溢出）、失去「一览所有房间」的能力。 | **作为备选**（见 §1.6） |

**与 PRD 约束的对齐**：单侧栏里「房间在上、成员在下」正好把房间做成「话题切换器」（主导航）、把 roster 留成全局在线（不强占每房间的视觉位），**不破坏 §2.2「不做 per-room 在线状态」**。

### 1.2 房间行（RoomRow）视觉规格 — 整套方案的视觉重心

所有值复用既有 token，**无需新增任何颜色变量**。

```
RoomRow（未选中 / 可切换）
  容器：  min-h-[36px]  rounded-md  px-4 py-1.5   ← 复用 roster 行的 px-4(16px) 横向节奏
  字体：  font-mono text-sm                        ← mono 强化「slug = 可寻址标识符」，与 #general badge 一脉
  文字：  text-muted-foreground
  前缀 #： text-muted-foreground/50                ← hash 比 slug 更暗半档，slug 才是「主体」
  hover： hover:bg-accent/70 hover:text-foreground ← 与 roster 行 hover 完全一致（已调教过）
  过渡：  transition-colors duration-fast (120ms, out-soft)  ← 复用既有曲线

RoomRow（当前房间 = 已调入）
  背景：  bg-accent                                  ← 实色填充（非 /70），=「按下的频道」
  文字：  text-foreground font-medium
  信号条： shadow-[inset_2px_0_0_0_hsl(var(--agent))] ← 左侧 2px mint 实色条 = 活跃频道（呼应消息行 pinged 的左侧条手法）
  前缀 #： text-agent/80                             ← mint hash，与品牌点同色 = 「这就是当前频率」
```

**行高说明**：房间行 `min-h-[36px]`（比 roster 成员行 44px 略紧凑）。理由：房间是「扫一眼挑一个」的导航，紧凑=更易纵览全貌（Linear/Raycast 侧栏导航项都在 32–36px）；roster 成员是身份、需要头像呼吸感，保持 44px。两段行高的细微差异反而强化了「导航（紧凑） vs 参考（宽松）」的层级。**注意**：行需是 `<button>`/`role="button"`，移动端 sheet 内须补到 `min-h-[44px]`（用既有 `.tap-target` 思路）以满足触控目标（WCAG 2.5.5）。

**`general` 系统房间的区分（PRD §5.2 要求）：**
- **永远置顶**（不参与字母序）。
- 其后放一条既有 `<Separator />`（`data-[orientation=horizontal]`，已存在的组件），把 `general` 与其它房间做一道极克制的分隔——传达「这是主频道」而不喧宾。
- `general` 行样式与其余房间**完全一致**（不做特殊徽章/锁图标，避免「官方房间」的官气）。仅靠「置顶 + 一道分隔线」完成区分。

### 1.3 当前房间的三重标识（互相强化，单一信号都不够）

1. **侧栏行**：实色 `bg-accent` + 左侧 mint 信号条 + mint `#`（见 §1.2）。
2. **topbar badge**：当前硬编码的 `#general` badge → **改为动态显示当前房间 slug**，并加一个 `ChevronDown`/`ChevronUpDown`(lucide 3.5) 微图标暗示「可切」（点击打开快捷切换，见 §1.5）。
3. **composer placeholder**：已是 `Send a message to #general` 参数化文案 → 改为 `Send a message to #<room>`，**无需新增动效**，文案本身即第 3 重确认。

### 1.4 空状态与边界态

| 场景 | 处理 | 规格 |
|---|---|---|
| 只有 `general`（没有任何别的房间） | ROOMS section 正常显示单行 `# general`（已选中），不报空、不弹引导；底部留 `+ new room` 行即可 | 复用既有 section 容器 |
| 当前房间**消息为空** | 复用既有空状态（`04` 截图那套 `text-2xl` + mint 短线 + body），但**标题/正文参数化房间名**：如 `#deploy-debug is quiet.` / `No messages here yet…` | 仅文案层改动，视觉不动 |
| 只有自己一个人（全局无人在线） | roster 全局本就如此（`Members — 0 online`），房间侧**不额外表达**「就你一个」，避免「鬼城」焦虑（与 PRD §8.7「不做 per-room presence」一致） | 不动 |

### 1.5 新建房间（轻量、内联，不做 dialog）

PRD §4.5：任何 participant 都能建房，建/进同一动作。视觉上**绝不能**做成「填写表单 → 提交 → 加入」的仪式感（那是「院子」味）。规格：

- ROOMS section 底部一行：`+ new room`，样式同 RoomRow 未选中态，但 `text-muted-foreground/60 hover:text-foreground`，前缀用 `Hash`+`Plus`(lucide 3.5) 组合。
- 点击 → **原地变内联输入框**（同行，不弹窗），`<input>` 复用 `bg-transparent border-b border-border focus:border-agent` 极简下划线样式。
- 实时校验 slug `^[a-z0-9][a-z0-9-]{0,30}$`：非法时输入文字 `text-destructive` + 提交时 `animate-shake`（已有 keyframe）；合法时回车即建（= `POST /rooms`，幂等）。
- 建完自动切到新房间（「建=进」）。

### 1.6 备选：顶部横向房间 tab（若产品坚持「最大化轻量 / 房间数长期 ≤5」）

仅当产品确认房间数极少时考虑：topbar 下方一条 `#general  #deploy-debug  #internal` 的横向 tab，当前 tab 下方一条 2px mint 线。优点：与 TUI「房间切换栏」**形态完全对等**、最轻量。缺点：>6 个溢出需折叠菜单。**本方案默认不采用**，因 PRD 未限制房间数上限、且侧栏更可扩展。保留此备选供产品选择。

---

## 2. 核心交互 / 动效（曲线 + 时长 + 触发，可直接成码）

### 2.1 切换房间（最高频，重点打磨）

**目标**：换台时维持空间认知连续性，不能「闪一下」、不能布局抖动。

| 阶段 | 动作 | 规格 |
|---|---|---|
| 点击房间行 | 行高亮切换 | `transition-colors duration-fast`（120ms, out-soft）—— 已选中态从旧行淡出到新行 |
| 拉取新房间历史 | message list 内容**交叉淡入** | 给 MessageList 容器加一个 `key={currentRoom}` 触发重挂载时的入场：`animate-[fade-in_180ms_cubic-bezier(0.16,1,0.3,1)]` + `translateY(4px)→0`。**180ms** 是切换场景的甜点（比消息入场 320ms 快——切换是主动操作、要利落） |
| 网络慢 | 骨架屏占位 | 不要让消息区「空一下再蹦出来」：用 2–3 条 `animate-shimmer`（已有）的灰色气泡占位，保持容器高度稳定 |
| 容器稳定 | **不抖动** | topbar/composer/searchbar 在切换中**完全不动**（它们与房间无关或已是参数化）。只有 message list 内部更替 |

> **不要做的事**：不要给整个 main 加滑入/缩放（那是「场景切换」，过重）；不要在切换时清空再填充（会闪白）。只更替 message list 内容层。

### 2.2 未读计数（P1）— 位置与样式

```
位置：RoomRow 行尾右侧（trailing），font-mono text-[10px] tabular-nums
普通未读 pill：
  bg-agent/15  text-agent  rounded-full  min-w-[18px] h-[18px] px-1  text-center
  ← mint = 品牌/通用信号，「有新内容」
含 @mention 的未读（被定向呼叫）：
  bg-human/25  text-human  同尺寸
  ← amber = human 指向你（复用双色灵魂）
  且整行加 border-l-2 border-l-human/50 bg-human/5  ← 镜像消息内 pinged 处理手法（既有 border-l-primary/40 bg-primary/5）
入场：未读从 0→1 时 pill 用 animate-in zoom-in-50 fade-in duration-fast（120ms）
清零：进入该房间瞬间 pill 用 animate-out fade-out-0 duration-fast 消失
```

**克制点**：未读计数**不闪烁、不脉冲**（那是 agent-pulse 的职责，别抢戏）。颜色 + 数字本身就是信号。

### 2.3 跨房间 mention 通知（P1）— 两个呈现面 + 直达

PRD §5.5：mention 收件箱全局、带来源房间、可直达。视觉给两个面：

**面 A — 来源房间的 RoomRow 持久标记：**
- 该行加 §2.2 的 amber pill + 左侧 amber 条（`border-l-2 border-l-human/50 bg-human/5`），即便你不是在看该房间，扫一眼侧栏就知道「那个房间有人 @ 我」。
- 点击该行 → 切到该房间 + 滚动定位到该消息（复用 MessageList 的滚动能力，见面 B 的直达）。

**面 B — 瞬态 toast（你正在别的房间时，有人跨房间 @ 你）：**
- 位置：右下角（`fixed bottom-4 right-4 z-50`），不遮挡 composer。
- 内容：`<avatar/agent dot> claude mentioned you in` `#deploy-debug` `→`，整条可点击。
- 配色：amber 强调（`border-l-2 border-l-human`，呼应 banner 手法），主体 `bg-card text-foreground`，`shadow-[var(--shadow-pop)]`（复用既有深色面阴影）。
- 动效：
  - 入场：`animate-in slide-in-from-bottom-3 fade-in-0 duration-slow`（320ms, out-quint）—— 从下滑入，柔顺。
  - 自动消失：~6s 后 `animate-out fade-out-0 slide-out-to-bottom-2 duration-200`。
  - hover 时**暂停自动消失**（让用户来得及点）。
- **点击直达**：切到来源房间 + 调 `MessageList` 滚到该 mention 消息 + 该消息行短暂高亮（`bg-human/5` 闪 1.2s 后消退，复用 pinged 视觉）。

**与 CLI/MCP 的对等**：Web 的 toast = CLI `listen --mention`（全局，不限定 room）命中后的唤醒；「来源房间」数据三端都有，只是呈现按终端能力各自表达。

### 2.4 房间行入场 / 新房间出现

- 新建/新发现的房间行出现时：`animate-slide-in`（既有，`translateY(6px) 320ms out-quint`），与消息入场同语言。
- 首次加载房间列表：可选给前几行 30ms 递增 stagger（`animation-delay: calc(var(--i)*30ms)`），让「频道逐个上线」——呼应「频率」隐喻。**克制**：房间多时关掉 stagger（避免长延迟）。

### 2.5 移动端房间切换

- topbar 的 `#<current-room>` badge 在最小屏当前是 `sm-reveal`（隐藏）。改为**始终可见且可点**：点击 → 底部弹出一个**房间选择 sheet**（复用 `06` 截图的右侧/底部 sheet 模式与 `slide-in-from-bottom` 动效），内含 ROOMS 列表 + `+ new room`。
- 成员 sheet（`Members — N online`）保持独立、只管成员——移动端两个入口职责分离，避免一个 sheet 塞两件事。
- 切换动效同桌面：选中行高亮 + 消息区交叉淡入 + sheet 收起（`slide-out-to-bottom duration-200`）。

---

## 3. 视觉语言总表（喂前端的 spec，全部复用既有 token）

| 元素 | 规格 | 复用的 token / 类 |
|---|---|---|
| ROOMS section 容器 | 与 roster Section 同：`px` 对齐 `pb-2`，标题复用 roster header | `font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/85` |
| ROOMS 与 roster 之间分隔 | 既有 `<Separator />` + `gap-4`（aside 已有 `gap-4`） | `Separator` 组件 |
| RoomRow 未选中 | `min-h-[36px] rounded-md px-4 py-1.5 font-mono text-sm text-muted-foreground` | `hover:bg-accent/70 hover:text-foreground transition-colors duration-fast` |
| RoomRow 选中 | `bg-accent text-foreground font-medium shadow-[inset_2px_0_0_0_hsl(var(--agent))]` | `#` 用 `text-agent/80` |
| `general` 区分 | 置顶 + 其后 `<Separator />` | 无新增 |
| 新建房间行 | `text-muted-foreground/60 hover:text-foreground`，`Hash+Plus`(lucide 3.5) | 行样式同 RoomRow |
| 未读 pill（普通） | `bg-agent/15 text-agent rounded-full min-w-[18px] h-[18px] font-mono text-[10px] tabular-nums` | mint |
| 未读 pill（mention） | `bg-human/25 text-human` 同尺寸 + 行 `border-l-2 border-l-human/50 bg-human/5` | amber |
| topbar 当前房间 badge | 动态 slug + `ChevronUpDown`(lucide 3.5) | 复用现有 badge 容器（`border border-border px-2 py-0.5 font-mono text-xs`） |
| toast（跨房间 mention） | `bg-card border-l-2 border-l-human shadow-[var(--shadow-pop)] rounded-lg` | `--shadow-pop`、amber |
| 切换交叉淡入 | `fade-in 180ms + translateY(4px)→0, cubic-bezier(0.16,1,0.3,1)` | out-quint（既有 DEFAULT） |

**零新增颜色 token**——这是本方案的刻意优势：多房间是导航扩展，不稀释既有「mint=agent、amber=human」双色灵魂，全部用既有 mint/amber/chrome/accent 组合表达。

---

## 4. 优先级拆分

### P0（对齐 PRD §8，MR8 房间语义）

1. 左侧栏 ROOMS section + 当前房间高亮（§1.2）。
2. `general` 系统房间置顶 + 分隔（§1.2）。
3. 切换房间 → 拉该房间历史 + 重订阅该房间流 + **消息区 180ms 交叉淡入、不抖动**（§2.1）。
4. topbar badge 动态化 + composer placeholder 动态化（§1.3）——三重当前房间标识。
5. 内联新建房间（§1.5，满足 MR5「任何 participant 可建」）。
6. 移动端：topbar 房间 badge 可点 → 房间选择 sheet（§2.5）。

### P1（对齐 PRD §8）

7. 每房间未读计数 pill（普通 mint / mention amber，§2.2）。
8. 跨房间 mention：RoomRow amber 持久标记 + 右下 toast 直达来源消息（§2.3）。
9. （建议追加，见 §7）快捷切换器 Cmd/Ctrl+K。

### P2（锦上添花，不强求）

10. 首次加载房间列表 stagger 入场（§2.4）。
11. 房间行 hover 时极淡的左侧高光（呼应 message row 选项）。

---

## 5. 三端映射（只给对应关系，Web 视觉如何落到 CLI/TUI 的简朴形态）

| Web 视觉概念 | CLI（`club`）对应 | TUI 对应 |
|---|---|---|
| ROOMS 侧栏列表 | `club rooms`（列出全部） | 房间切换栏（横向，当前高亮） |
| 当前房间（mint 高亮 + topbar badge） | `club enter <room>` 写 config 为默认；`--room` 覆盖 | 当前 tab 高亮 |
| 切房间交叉淡入 | （无动画，终端天然）切换即时 | tab 切换即时重订阅流 |
| 新建房间（内联 = 建/进） | `club enter <new-room>` 隐式创建（PRD §8.4） | 同 CLI |
| 未读 pill（P1） | `club rooms` 输出可标未读计数（数据三端同源） | tab 上挂计数（终端能力内表达） |
| 跨房间 mention toast（P1） | `listen --mention` 全局命中即醒，输出含来源房间 | listen 提示含来源房间 |
| composer 发到当前房间 | `club send`（无 `--room` → 默认房间） | 同 CLI |

**关键**：Web 的「实色填充 + mint 信号条 = 当前频道」这套**视觉**语言，在 CLI/TUI 降级为「当前项高亮 / 默认值」的**简朴**表达——语义完全对等，无 Web 独占的房间交互。`enter`（非 `join`）动词三端统一（PRD #003）。

---

## 6. 可测视觉验收点（喂 @王测开 / @王前端 对照）

**P0**
- [ ] 左侧栏顶部出现「ROOMS」section，`#general` 置顶、选中态（实色 bg + 左 mint 条 + mint `#`）。
- [ ] `general` 与其它房间之间有一道 `<Separator />`。
- [ ] 点击另一房间：侧栏高亮迁移（120ms）、topbar badge 与 composer placeholder 同步变更新 slug、message list 180ms 交叉淡入且 topbar/composer 不抖动。
- [ ] 切换后网络请求带该 room（playwright 断言 `GET /messages?room=<slug>`）。
- [ ] 在当前房间发消息 → 落点为当前房间（断言 message.room）。
- [ ] `+ new room` 内联输入：合法 slug 回车即建并切过去；非法 slug 触发 `animate-shake` + destructive 提示。
- [ ] 移动端（390×844）：topbar 房间 badge 可点 → 房间 sheet 列出房间，切换后 sheet 收起。
- [ ] 只有 `general` 时：ROOMS 单行、无报空、有 `+ new room`。

**P1**
- [ ] 别的房间来消息（非当前）：该房间行尾出现 mint 未读 pill，数字 tabular-nums。
- [ ] 跨房间 @ 当前用户：该房间行变 amber pill + 左 amber 条；右下 toast 出现（slide-in-from-bottom 320ms），点击 toast → 切到来源房间 + 滚到该消息 + 该消息短暂高亮。
- [ ] toast ~6s 自动消失，hover 暂停消失。
- [ ] 进入有未读的房间：pill 120ms 淡出，未读清零。

**通用**
- [ ] 全程尊重 `prefers-reduced-motion`（既有全局兜底应已覆盖新增 animate-in/out）。
- [ ] 键盘：RoomRow 可 Tab 聚焦、Enter/Space 切换、有可见 focus ring（复用 `focus-visible:ring` 模式）。

---

## 7. 设计层对产品约束的建议（与 PRD 差异点，请 @王产品 复核）

以下是我作为设计专家的主动建议，**不违背**任何硬约束，但提请产品知晓/取舍：

1. **[建议追加 P1] 快捷切换器 Cmd/Ctrl+K。** 一线产品（Linear/Vercel/Raycast/Slack）的房间/项目切换都用 Cmd+K。它**强化**「轻量调台」的主线（不打开侧栏也能瞬切），且 CLI 对等物是 `club enter <room>` 的补全。建议作为 P1 增强加入，与未读/mention 同批。**与 PRD 差异点**：PRD §5.2 未提快捷键，属增量建议。

2. **[认可约束] slug-only，不做中文展示名。** 从视觉角度**完全赞同**——slug 配 mono 字体恰好是「可寻址技术标识」的高级感（Linear/Vercel 味），比中文展示名更克制、更有作者性。**建议**：未来做 P1 展示名时，展示名降为次级（muted、更小字号），slug 仍作主标识，不要让展示名盖过 slug。这维护「slug = 稳定寻址」的产品意图。

3. **[认可约束] 不做 per-room 在线状态。** 视觉上**更干净**——避免了冷门房间的「鬼城」焦虑，也让 roster 保持「全局谁在」的单一职责。无异议。

4. **[提醒] topbar 当前房间 badge 在最小屏当前用 `sm-reveal` 隐藏。** 多房间后它变成「可点的房间切换入口」，**必须**在所有断点可见。这会占用移动端 topbar 空间——实现时需重排移动端 topbar（可能把 view-key 让进成员 sheet、或 lang 收进菜单）。**与现状差异点**：移动端 topbar 需为房间入口腾位，属实现期细节，提请 @王前端 注意。

5. **[可选] 房间排序策略。** 本方案默认「`general` 置顶 + 其余按 slug 字母序」。若产品希望「最近活跃优先」或「未读优先」，请示下——视觉上「未读置顶 + mint/amber 标记」会很灵动，但会改变静态列表的「稳定可预期」手感。**留作产品决策**。

---

## 附：实现落点提示（交 @王前端，不含代码）

- 新增组件 `RoomList` / `RoomRow`，挂进现有 `Roster` aside 顶部（`RosterSections` 之上）。
- `App.tsx` 新增 `currentRoom` state（默认 `'general'`，持久化到 localStorage），传入 Topbar / Composer / MessageList / useMessageStream（流按 room 过滤）。
- topbar 的硬编码 `#general`（`topbar.tsx:57-59`）改为 `currentRoom` + 可点 trigger。
- `api.ts` 的 `messages`/`send` 加 `room` 参数；新增 `rooms()` / `createRoom()`。
- 复用：`Separator`、`shadow-pop`、`accent`、`agent`/`human` token、`animate-slide-in`/`shimmer`/`shake` keyframes、out-quint 曲线——**零新增 token、零新增 keyframe**（Cmd+K 若做需新增一个 fade/slide 组合，仍可复用既有曲线）。
