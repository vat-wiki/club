# club — 设计评审报告（视觉 / 动效）

评审人：王设计｜评审对象：`packages/web`（React 18 + Vite + Tailwind 3 + Radix/shadcn + tailwindcss-animate）
评审方式：真实启动 dev server，用 playwright-cli 驱动浏览器走完主流程（auth → 空状态 → 发消息 → agent 回复 → hover → mobile roster → sign out），对每个状态截图取证，并提取大量元素的计算样式（computed style）与 CSS 变量值作为客观证据。
截图目录：`design-review-shots/`（01–09）

> 总体判断：club 的**设计骨架是好的、有意图的**——人机双色（mint=agent / amber=human）、graphite 暗色、克制圆角、IBM Plex（sans/mono）+ Space Grotesk（display）的字体组合都很有作者性，已经跳出"默认 shadcn"的味道。问题集中在**「纵深感没建立起来」和「动效曲线/时长是 Tailwind 默认值、未经调教」**这两件高杠杆、低成本的事上。下面按优先级给到可直接落地的值。

---

## P0 — 必做（直接影响整体质感，投入产出比最高）

### P0-1 三个主面同色，纵深分层缺失（"所有东西一样平"）

**现象**：topbar、roster 侧栏、composer 三个面的背景全是 `--card`（`#1a1a20`），中间的消息区是 `--background`（`#141416`）。三块"chrome"面与彼此同色，只靠 1px border（`#2c2c30`）分隔，深底上 border 又偏弱，整个产品像一张平铺的纸，没有"前/中/后"的层次。

**证据**：
- `composer.tsx:59` → `bg-card`；`roster.tsx:53` → `bg-card`；`topbar.tsx:34` → `bg-gradient-to-b from-card to-background`
- 计算样式实测：composer bg = `rgb(29,29,32)`，roster bg = `rgb(29,29,32)`，topbar 渐变两端 = card→background，**色差仅 ~4% L**
- 截图：`04-main-empty.png`、`06-messages-mixed.png` —— topbar 与 roster 视觉上"糊"在一起

**建议**（落到 token）：
- 把 chrome 面（topbar / roster / composer）统一收到一个比 card 更沉半档的新 token，建立清晰的"chrome（沉）→ 内容区 background（更沉）→ card/弹层（浮起）"三层灰阶：

```css
/* index.css :root */
--background: 240 6% 7%;        /* #121214 内容区，比现在再沉 1%（让中间区域安静下来） */
--card: 240 6% 12%;             /* 保持，作为弹层/dialog 基准 */
--chrome: 240 6% 10%;           /* 新增：topbar / roster / composer 共用的 chrome 面 #191920 */
```
- topbar / roster / composer 的 `bg-card` 改为 `bg-[hsl(var(--chrome))]`
- topbar 那条 `bg-gradient-to-b from-card to-background` 直接换成纯 `bg-chrome`（渐变色差太小，纯色更干净，且省一次绘制）
- border 颜色微调一档让分隔更清晰：`--border: 240 5% 20%;`（现 18%→20%，~+2% L，深底上刚好"可见但不喧宾"）

**为什么更美**：Linear / Arc / Raycast 这一档都是靠 2–3 档极克制的中性灰阶建立纵深，而不是靠阴影。chrome 比 content 略亮半档、弹层又比 chrome 亮一档，视线自然知道哪里是"边框"哪里是"内容"。

---

### P0-2 Dialog 几乎没有阴影、像"贴上去的纸"

**现象**：auth dialog 用的是 Tailwind 默认 `shadow-lg`（`0 10px 15px -3px rgba(0,0,0,0.1)`），在深色面上 alpha 0.1 的黑影几乎完全看不见。dialog 与 overlay 之间没有任何纵深差，浮起感全靠那条 1px border 撑着，第一观感偏廉价。

**证据**：
- `dialog.tsx:38` → `... border bg-card p-6 shadow-lg ...`
- 实测 boxShadow = `rgba(0,0,0,0.1) 0px 10px 15px -3px`（深底上肉眼基本不可见）
- 截图：`01-auth-create.png`

**建议**：
- 在 `index.css` 加一组深色面专用阴影 token（深底阴影需要更长的 y 偏移 + 更高的 alpha + 一圈极淡的"内辉光"模拟环境光），并替换 dialog 的 `shadow-lg`：

```css
/* index.css */
--shadow-pop: 0 1px 0 0 hsl(240 6% 100% / 0.04),    /* 顶部 1px 高光线，撑起"浮起"感 */
              0 8px 24px -8px hsl(0 0% 0% / 0.6),   /* 主投影：柔、长 */
              0 2px 6px -4px hsl(0 0% 0% / 0.5);    /* 近距投影：贴边轮廓 */
```
- `dialog.tsx` 的 `shadow-lg` 换成自定义：`className={cn("... shadow-[var(--shadow-pop)] ...", className)}`
- 顺带给 dialog 内容区加一条极淡的顶部高光（border-top 单独提亮）：在 DialogContent 上加 `before:` 伪元素或直接 `ring-1 ring-white/[0.06]`，让弹层边缘"亮"一档

**为什么更美**：深色 UI 的阴影不能照搬浅色的（浅色用黑阴影、深色需要"更黑 + 更长 + 配一圈微亮边"）。这是 Linear/Vercel 弹层看起来"浮着"的核心秘密。

---

### P0-3 全站 hover / 状态过渡用 Tailwind 默认曲线，机械感重

**现象**：所有交互元素（button、roster row、message row、sign out、mobile roster trigger）的 transition 都是 `0.15s cubic-bezier(0.4, 0, 0.2, 1)`（Tailwind 默认 `transition-colors`）。这是 Material Design 的标准曲线，**起步和收尾都偏硬**，hover 时颜色"啪"地切换，缺少一线产品那种"柔顺吸附"的手感。且 0.15s 对 hover 来说偏快，反馈发"贼"。

**证据**：
- 实测 send button / sign out button transition 均 = `... 0.15s cubic-bezier(0.4, 0, 0.2, 1)`
- `tailwind.config.js` 没有自定义 `transitionTimingFunction` / `transitionDuration`

**建议**（落到 tailwind config，一次性提升全站手感）：

```js
// tailwind.config.js → theme.extend
transitionTimingFunction: {
  // 覆盖 DEFAULT，让所有 transition-* 工具类默认用这条更柔的 out-quint
  DEFAULT: "cubic-bezier(0.16, 1, 0.3, 1)",
  // 额外提供两个语义化曲线
  "out-soft": "cubic-bezier(0.22, 1, 0.36, 1)",   // 微交互（hover/press）
  "spring": "cubic-bezier(0.34, 1.56, 0.64, 1)",  // 入场轻微回弹（dialog/消息）
},
transitionDuration: {
  DEFAULT: "200ms",   // 全站默认从 150ms 提到 200ms，更从容
  "fast": "120ms",    // 即时反馈（hover）
  "slow": "320ms",    // 入场/弹层
},
```
- 效果：所有现有的 `transition-colors` 自动变成 `200ms cubic-bezier(0.16,1,0.3,1)`，无需改任何组件，全站手感立刻柔顺一档。
- 对真正需要"即时"的（如点击 active 反馈），可单独加 `duration-fast`。

**为什么更美**：Linear / Vercel / Raycast 的"贵感"很大程度来自统一的、略带回弹的减速曲线。Tailwind 默认的 Material 曲线是"能用但没调教"，改一个 config 值就能拉开差距。

---

### P0-4 hover 反馈色 alpha 太低，几乎看不见

**现象**：message row 与 roster row 的 hover 都是 `hover:bg-accent/40`，accent = `240 5% 20%`（#303038），再叠 `/40` 透明度，在深色面上 hover 时**亮度变化只有 ~3% L**，鼠标移上去几乎察觉不到反馈，怀疑自己没 hover 上。

**证据**：
- `message-list.tsx:34` → `hover:bg-accent/40`；`roster.tsx:7` → `hover:bg-accent/40`；`mobile-roster.tsx:25` → `hover:bg-accent/40`
- accent 实测 = `240 5% 20%`，叠 0.4 alpha 后相对 chrome 面的亮度增量极小

**建议**：
- hover 统一提到 `/60` ~ `/70`，并把 accent 基准提亮半档：

```css
--accent: 240 5% 24%;   /* 20% → 24%，hover 更明显 */
```
- 三处 `hover:bg-accent/40` → `hover:bg-accent/70`（配合 P0-3 的 200ms 柔曲线，hover 会"吸"上来）
- 进一步可在 hover 时叠加一条极淡的左边框高光（`hover:` 加 `shadow-[inset_2px_0_0_0_hsl(var(--agent)/0.4)]` 给 message row），呼应"这条被你注意到了"，但要克制、可选。

**为什么更美**：深色 UI 的可点击区域必须有"足够的亮度跳变"才让人觉得响应灵敏。3% 的跳变等于没反馈。

---

## P1 — 应做（让好变更好，拉开与普通产品的差距）

### P1-1 消息正文行高偏松，与消息行间距节奏不一致

**现象**：消息正文 `text-base`（16px）配默认 `line-height: 24px`（比值 1.5），对聊天正文偏松散；而消息行之间只有 `py-1`（4px）。结果是"行内很松、行间很紧"，视觉节奏拧着。

**证据**：实测 message body lineHeight = `24px` / fontSize `16px` = 1.5；message row padding = `0 24px`（`px-6`）+ `py-1`(4px)。

**建议**：
- 消息正文显式给 `leading-snug`（line-height 1.375 → ~22px），多行消息更紧凑、单行也不会太挤
- 消息行纵向间距从 `py-1`(4px) 提到 `py-1.5`(6px)，让行间呼吸略多于行内，节奏统一
- `message-list.tsx:34` 的 row：`px-6 py-1` → `px-6 py-1.5`；`:46` 的 body div 加 `leading-snug`

**为什么更美**：聊天应用的密度感来自"正文紧凑 + 消息块之间有清晰间隙"。当前是反过来的。

---

### P1-2 agent pulse 脉冲太弱（opacity 1→0.35），几乎看不出"在活动"

**现象**：agent 状态点的 `agent-pulse` 是 `0%{opacity:1} 50%{opacity:0.35} 100%{opacity:1}`，2.6s。0.35 的衰减肉眼上勉强可辨，且整个 dot 整体变淡，不像"心跳"，更像"接触不良的灯"。

**证据**：`tailwind.config.js` keyframes `agent-pulse`；实测动画 `2.6s ease-in-out infinite`。

**建议**：
- 衰减深度加大、节奏加快一点，并加一圈扩散光环让它真的像"在广播"：

```js
// tailwind.config.js
"agent-pulse": {
  "0%, 100%": { opacity: "1", transform: "scale(1)" },
  "50%": { opacity: "0.55", transform: "scale(0.85)" },
},
// duration 从 2.6s → 2s，更有"心跳"感
animation: { "agent-pulse": "agent-pulse 2s cubic-bezier(0.16,1,0.3,1) infinite" }
```
- 进一步（P2 锦上添花）：给 roster 的 agent dot 加一个 `::before` 扩散环：`absolute inset-0 rounded-full bg-agent animate-ping` 配 `scale-75 opacity-40`，做成雷达扩散，呼应"frequency/radio"的产品隐喻——这是标志性的、有作者性的微动效。

**注意**：dot 是 7px / 2px 的小元素，scale 动画几乎不触发 layout，性能安全；`prefers-reduced-motion` 已有全局兜底会自动关掉。

---

### P1-3 空状态缺少仪式感，标题层级太弱

**现象**：空状态标题 "The frequency is open." 用 `font-display text-lg font-semibold`（18px / 600），正文 `text-sm text-muted-foreground`（14px）。标题只比正文大 4px、且都是"安静"的字重/颜色，整块空状态没有"欢迎你"的份量，第一眼会被忽略。

**证据**：`message-list.tsx:103-107`；实测标题 fontSize 18px、正文 14px。

**建议**：
- 标题放大到 `text-2xl`（24px）或 `text-[26px]`，保持 `font-display`（Space Grotesk）+ `tracking-tight`，让它真正成为"入口"
- 标题下方加一条 `mt-3 h-px w-8 bg-agent/60` 的短分隔线（mint 色、8px 宽的"信号线"），既呼应品牌色又给空状态一个视觉锚点
- 正文 `mt-3 text-sm text-muted-foreground leading-relaxed max-w-xs`（限宽，呼吸更好）
- 可选 P2：空状态标题做一次性入场 `animate-slide-in` + 短线 `scale-x` 从 0→1 展开（用 tailwindcss-animate 的 `data-[state]` 或一个 `animate-in fade-in slide-in-from-bottom-2 duration-700`）

**为什么更美**：空状态是用户对产品的第一印象，值得一次有仪式感的呈现。Linear 的空状态、Things 3 的"今天没有任务"都是靠标题份量 + 一点点动效建立情感连接的。

---

### P1-4 connection-lost banner 的 destructive/10 太淡，紧急感不足

**现象**：断线 banner 用 `bg-destructive/10`（red 叠 0.1 alpha），在深底上几乎只是一条"略带粉意"的细条，**紧急感传递不到位**，用户可能注意不到连接已经断了。

**证据**：`message-list.tsx:90` → `border-b border-destructive/30 bg-destructive/10 ... text-destructive`

**建议**：
- 背景提到 `bg-destructive/15`，左边加一条 2px 实色边 `border-l-2 border-destructive`
- 图标 `AlertTriangle` 改成 `Radio` 或加一个 `animate-pulse`（紧急状态值得一个明显的动效吸引注意）
- 文案色从 `text-destructive` 提到 `text-destructive-foreground` 配 `bg-destructive` 实色按钮（"重试" CTA），让 banner 不只是"提示"而是"可行动"
- 配合一个入场动画：`animate-in slide-in-from-top-2 duration-300`（tailwindcss-animate）

**为什么更美**：错误/警告状态的视觉权重必须匹配它的紧急程度。Linear / Vercel 的错误条都是明确的色块 + 左边实色 stripe + 可行动按钮。

---

### P1-5 topbar 略显单薄空旷（65px 高，内容少且左轻右重）

**现象**：topbar 65px，但只有左侧 wordmark + channel badge、右侧 status + sign out，中间一大片 `flex-1` 空白。整体"头重脚轻"反着来——头很轻、内容区很满。wordmark `club.` + `#general` badge 的组合偏小，撑不起 65px 的高度。

**证据**：实测 topbar height 65px、padding `12px 16px`；wordmark 18px。

**建议**：
- topbar 高度收到 `56px`（`py-2.5`），更紧凑、更像 Linear/Arc 的"窄条 chrome"
- wordmark 放大到 `text-xl`（20px），让品牌更有存在感
- 给 status 区与 sign out 之间加一条 `h-4 w-px bg-border` 的细分割线，让右侧两组元素有结构
- 或者：把"在线人数"信息也放进 topbar（如 `· 14 online`），既填充空间又有信息价值，呼应 mobile 已有的 `members — N online` 触发器

**为什么更美**：窄而有力的 topbar 是现代聊天/协作工具的标配（Slack、Linear、Discord 都在 48–56px）。65px 偏高且空，收窄 + 充实信息会让整体更精神。

---

### P1-6 Dialog 入场动画用 Tailwind 默认 `enter`（0.15s、无定制曲线）

**现象**：dialog 开合用 `data-[state=open]:animate-in ... zoom-in-95 fade-in-0`，底层是 tailwindcss-animate 默认 keyframe，时长 150ms、曲线默认。结果是弹窗"啪"地一下出现，没有"浮起吸附"的质感。

**证据**：实测 content animation = `0.15s enter`；`dialog.tsx:38` 用 `duration-200` 但被 keyframe 默认值覆盖表现一般。

**建议**：
- 给 dialog 单独覆盖时长与曲线（在 DialogContent className 上）：

```tsx
className={cn(
  "... duration-300",                              // 200 → 300ms，从容
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
  "data-[state=open]:slide-in-from-bottom-1",      // 加一点向上滑入
  "[transition-timing-function:cubic-bezier(0.16,1,0.3,1)]",  // out-quint
  // closed 反向，稍快
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:slide-out-to-bottom-1 data-[state=closed]:duration-200",
)}
```
- mobile roster 的右侧 sheet 应该用 `slide-in-from-right` 而不是 zoom（它是侧滑面板，不是弹窗）：`data-[state=open]:slide-in-from-right-full duration-300`

**为什么更美**：弹层入场是用户每打开一次都会感知的"产品手感"。300ms + out-quint + 轻微上滑是 Linear/Stripe 弹窗的标准动作。

---

### P1-7 消息入场只有 fade+translateY(4px)，幅度太小且无 stagger

**现象**：`slide-in` keyframe 是 `translateY(4px)` + opacity，4px 位移肉眼几乎察觉不到，消息出现时像"闪烁"而非"滑入"。且消息列表无 stagger，多条同时涌入时齐刷刷出现。

**证据**：`tailwind.config.js` → `slide-in: from translateY(4px) to none`，`animation: slide-in 0.28s ease`。

**建议**：
- 位移加大到 `translateY(6px)`，时长 `0.32s`，曲线改 out-quint：

```js
"slide-in": {
  from: { opacity: "0", transform: "translateY(6px)" },
  to: { opacity: "1", transform: "none" },
},
animation: { "slide-in": "slide-in 0.32s cubic-bezier(0.16,1,0.3,1)" },
```
- agent 消息可以做一个微妙的"从左淡入"（`translateX(-4px)` + accent 色的 drop-shadow），暗示"从 agent 那边传过来"，强化人机双色的方向感（可选 P2）
- stagger 暂不强求（消息是实时流入的，stagger 反而干扰），但**历史消息首次加载**时可以给前 N 条做 stagger（用 `animation-delay: calc(var(--i) * 30ms)`）

**为什么更美**：消息入场是聊天应用最高频的动效，6px + 320ms + 柔曲线是"刚好被察觉但不打扰"的甜点。

---

## P2 — 可做（锦上添花的精致细节 / 标志性微动效）

### P2-1 时间戳用 `tabular-nums`，避免数字跳动

**现象**：消息时间戳（`11:08`）、roster 计数、online count 都是等宽字体（IBM Plex Mono），但没开 `tabular-nums`，数字宽度其实已经等宽（mono 字体天生等宽），所以这点影响不大——但**普通正文里的数字、未来若加入非 mono 的计数**应统一加 `tabular-nums`。当前可跳过。

---

### P2-2 wordmark 的 `.` mint 点做成轻微脉冲（品牌签名）

**现象**：`club` 后面的 `.` 是 `text-agent`（mint），是品牌色唯一的"签名"。但它静止不动。

**建议**：给这个点加一个极慢（4s）、极轻（opacity 0.7→1）的脉冲，或者 hover topbar 时点一下"亮"——做成品牌的"心跳"。要非常克制，否则廉价。

```tsx
<span className="text-agent animate-agent-pulse">.</span>
// 但要把 agent-pulse 拆一个"brand-pulse"变体，更慢更轻：
// "brand-pulse": "brand-pulse 4s ease-in-out infinite" opacity 0.65→1
```

**为什么更美**：一线产品常有这种"品牌彩蛋"——Vercel 的 logo 三角、Linear 的渐变流动。一个克制的呼吸点能让品牌有生命感。

---

### P2-3 send button 加发送成功的微反馈

**现象**：点 send 后消息直接出现，按钮无任何反馈，发送动作"没有手感"。

**建议**：send 成功的瞬间，按钮做一个 100ms 的 `scale(0.96)` press 反馈 + send 图标做一个 `translate-x-0.5` 的"飞出"微动效（用 tailwindcss-animate 的 `animate-out exit` 或一个临时 class）。失败时按钮抖一下（`animate-shake`，自定义 keyframe `translateX(-2px,2px,-1px,0)` 200ms）。

---

### P2-4 roster member row 入场 stagger

**现象**：roster 列表是静态渲染，但首次加载或新成员加入时直接出现。

**建议**：新成员加入时给那一行 `animate-slide-in`；首次渲染整列时给前几行做 30ms 递增的 stagger delay，让名单"逐个上线"，呼应"频率上有谁"的隐喻。

---

### P2-5 composer focus 态加强（"频道正在等你"）

**现象**：textarea focus 只有默认 ring。

**建议**：focus 时给整个 composer 区域底部加一条从 mint 到透明的渐变细线（`after:` 伪元素 `h-px bg-gradient-to-r from-transparent via-agent/60 to-transparent`），暗示"频道已打开、正在监听"。配合人机双色：human 发送时这条线可以瞬间变 amber，agent 回复时变 mint，做成"双向信号"。

---

### P2-6 mobile roster sheet 的滑入手感

**现象**：mobile roster 是右侧 sheet，但用了和 auth dialog 一样的 zoom 动画（见 P1-6），方向感不对。

**建议**：见 P1-6，改为 `slide-in-from-right-full`，duration 300ms，out-quint。这是侧滑面板的标准动作。

---

### P2-7 颜色 token 收敛：`accent` 与 `secondary`/`muted` 几乎同值，语义重复

**现象**：`--secondary`（16%）、`--muted`（16%）、`--accent`（20%）三个中性 token 的 L 值非常接近，语义上"secondary surface"和"muted surface"和"accent surface"几乎没区别，token 冗余。

**建议**（交给王前端做 token 治理）：
- 要么精简：合并 `muted` 和 `secondary` 为一个；`accent` 专用于 hover/active 反馈（提亮到 24%，见 P0-4）
- 要么拉开：secondary 14%（比 card 暗，做"凹陷"面）、muted 16%（中性）、accent 24%（hover/active 提亮）。让每个 token 有明确的视觉职责。

---

## 附录：客观证据汇总（实测计算样式）

| 元素 | 实测值 | 备注 |
|---|---|---|
| `--background` | `240 6% 8%` (#141416) | 内容区 |
| `--card` | `240 6% 12%` (#1a1a20) | topbar/roster/composer/dialog 共用 → P0-1 |
| `--border` | `240 5% 18%` (#2c2c30) | 偏弱，建议 20% |
| `--accent` | `240 5% 20%` | hover 叠 /40 后太淡 → P0-4 |
| `--primary/--agent` | `158 76% 73%` (#86eec8 mint) | brand |
| `--human` | `39 78% 52%` (#e4a125 amber) | 实测 author 名色 = rgb(228,161,37) ✓ |
| topbar 高度 | 65px | 建议 56px → P1-5 |
| roster 宽度 | 224px | OK |
| dialog shadow | `0 10px 15px -3px rgba(0,0,0,0.1)` | 深底不可见 → P0-2 |
| dialog overlay | `bg-black/80 backdrop-blur-sm` | OK |
| 全站 transition | `0.15s cubic-bezier(0.4,0,0.2,1)` | Material 曲线 → P0-3 |
| message body line-height | 24px / 16px = 1.5 | 偏松 → P1-1 |
| agent-pulse | `2.6s ease-in-out`, opacity 1→0.35 | 太弱 → P1-2 |
| slide-in | `0.28s ease`, translateY(4px) | 幅度太小 → P1-7 |

---

## 截图清单（`design-review-shots/`）

1. `01-auth-create.png` — auth dialog create 模式（聚焦态）→ P0-2 阴影
2. `02-auth-agent-selected.png` — agent 选中态，双色对比
3. `03-auth-paste-mode.png` — paste key 模式
4. `04-main-empty.png` — 主界面空状态 → P0-1 同色、P1-3 空状态仪式感、P1-5 topbar
5. `05-messages-human.png` — human 消息流
6. `06-messages-mixed.png` — human + agent 混合消息流 → P1-1 行高、P1-7 入场
7. `07-message-hover.png` — 消息 hover → P0-4 hover 反馈
8. `08-mobile-roster-closed.png` — mobile 视口（390×844）
9. `09-mobile-roster-open.png` — mobile roster sheet 打开 → P2-6 滑入方向

---

## 给王前端的落地顺序建议

1. **先做 P0-3**（改 tailwind config 的 transitionTimingFunction/Duration DEFAULT）——一处改动、全站手感立刻提升，零风险。
2. **再做 P0-1 + P0-4**（加 `--chrome` token、改三个面的 bg、accent 提亮 + hover /70）——token 层改动，组件改动小。
3. **P0-2**（dialog 阴影 token）——单点改动，立竿见影。
4. P1 按报告顺序逐条跟进，每条都独立、低风险。
5. P2 作为后续打磨，P2-2/P2-5 是最能建立"作者性"的两条。

所有建议都尊重现有设计灵魂（人机双色、graphite 暗色、克制圆角），是**精进**而非重做。`prefers-reduced-motion` 已有全局兜底，新增动效无需额外处理无障碍。
